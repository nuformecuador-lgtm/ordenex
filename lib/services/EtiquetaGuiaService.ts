// Feature 32 — Orquesta "Etiqueta de guia": READ derivado que arma el payload de
// etiqueta (QR + codigo de barras + datos) por cada orden con `num_guia`. Sin
// tabla ni migracion nueva. Servicio dedicado, separado de OrdenService (CRUD):
// ensambla nombres de geografia/tienda y decide QR/barcode en un solo lugar, algo
// que no encaja en el `obtener`/`listar` generico (design.md §3, alternativa C
// descartada). No conoce HTTP ni Prisma directamente (DI por constructor).
import type { EtiquetaRow, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EtiquetaPorGuiaServiceResult,
  GenerarEtiquetasInput,
  GenerarEtiquetasServiceResult,
  IEtiquetaGuiaService,
} from "@/lib/interfaces/services/IEtiquetaGuiaService";
import type { EtiquetaGuiaDTO, EtiquetaOmitidaDTO } from "@/lib/types/etiqueta-guia";

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Feature 136 — ¿puede este actor ver la etiqueta de esta orden?
 *
 * El rol `apiKey` (canal de integracion de la carga por API) SOLO ve las ordenes
 * de su propia tienda: `actor.usuarioId` es el `tienda_id` con el que se crean sus
 * ordenes (`BulkOrdenService.cargarViaApi`). Desde la feature 302 ese id es el DUENO
 * resuelto por `ApiKeyAuthService` —la tienda real apuntada por la key, o su cuenta
 * dedicada si no apunta a ninguna—, no siempre la cuenta dedicada. La regla no cambia:
 * el actor ve las ordenes de UN solo dueno, el suyo.
 * Hasta ahora el aislamiento entre tiendas descansaba unicamente en el borde —los
 * `ordenIds` salen del summary de la propia carga—, asi que un futuro llamador que
 * pasara ids ajenos filtraria datos de otra tienda sin que nada lo impidiera. La
 * invariante se fija aqui, en el service, que es donde vive la autorizacion.
 *
 * Los roles de sesion (maestro/admin/adminTienda/mensajero/adminSatelite) mantienen
 * el comportamiento previo: la etiqueta es un READ derivado abierto a cualquier rol
 * autenticado (decision cerrada en la feature 32).
 */
function esVisiblePara(row: EtiquetaRow, actor: Actor): boolean {
  if (actor.rol !== "apiKey") return true;
  return row.tiendaId === actor.usuarioId;
}

export class EtiquetaGuiaService implements IEtiquetaGuiaService {
  constructor(private readonly repo: IOrdenRepository) {}

  async generarEtiquetas(
    input: GenerarEtiquetasInput,
    actor: Actor,
  ): Promise<GenerarEtiquetasServiceResult> {
    // Autorizacion: la etiqueta es un READ derivado disponible para cualquier rol
    // autenticado (decision del usuario). La sesion ya se exige en el borde
    // (Server Action -> `unauthenticated` sin sesion); para los roles de sesion no
    // se restringe por rol ni se filtra por visibilidad de la orden.
    //
    // EXCEPCION (feature 136): el rol `apiKey` SI se filtra por dueño (ver
    // `esVisiblePara`). Es un canal de integracion externo, no una sesion humana.
    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", etiquetas: [], omitidas: [] };

    // R1/R3: filas ya sin borradas (el repo filtra deletedAt: null).
    const rows = await this.repo.findEtiquetasByIds(ordenIds);
    const rowById = new Map<string, EtiquetaRow>(rows.map((r) => [r.id, r]));

    const etiquetas: EtiquetaGuiaDTO[] = [];
    const omitidas: EtiquetaOmitidaDTO[] = [];

    // Se recorre la SELECCION solicitada (no las filas) para reportar tambien las
    // que no vinieron de la query. Una orden invalida NO aborta el lote (R3).
    for (const ordenId of ordenIds) {
      const row = rowById.get(ordenId);
      if (!row || !esVisiblePara(row, actor)) {
        // No existe, esta borrada (el repo la excluyo por deletedAt) o es de otra
        // tienda y el actor es una API key (feature 136). En los tres casos se
        // reporta igual: `no_encontrada` NO revela la existencia de la orden ajena.
        omitidas.push({ ordenId, motivo: "no_encontrada" });
        continue;
      }
      if (row.numGuia === null) {
        // Existe pero aun sin guia asignada: no tiene QR/etiqueta disponible (R2).
        omitidas.push({ ordenId, motivo: "sin_guia" });
        continue;
      }
      etiquetas.push(this.toEtiquetaDTO(row, row.numGuia));
    }

    return { status: "ok", etiquetas, omitidas };
  }

  async obtenerEtiquetaPorGuia(
    numGuia: number,
    actor: Actor,
  ): Promise<EtiquetaPorGuiaServiceResult> {
    // Misma autorizacion que `generarEtiquetas`: READ derivado disponible para
    // cualquier rol autenticado (la sesion se exige en el borde), salvo `apiKey`,
    // que solo ve las ordenes de su propia tienda (feature 136).
    const row = await this.repo.findEtiquetaByNumGuia(numGuia); // ya filtra borradas (R3)
    if (!row || row.numGuia === null || !esVisiblePara(row, actor)) {
      return { status: "no_encontrada" };
    }
    return { status: "ok", etiqueta: this.toEtiquetaDTO(row, row.numGuia) };
  }

  // R1/R4/R5/R6/R7/R8: arma el DTO de una orden con guia. `numGuia` se recibe ya
  // estrechado a `number` (el llamador descarto el caso null, R2). montoCobrar es
  // number|null sin moneda (R5); distritoNombre null si no hay (R4); qrValue =
  // String(numGuia) (R7, la UI construye la URL del paquete `/paquete/<numGuia>`);
  // barcodeValue = String(numGuia) (R8): QR y barcode codifican el MISMO valor.
  // No expone deletedAt (R6): la fila ni siquiera lo trae.
  private toEtiquetaDTO(row: EtiquetaRow, numGuia: number): EtiquetaGuiaDTO {
    return {
      ordenId: row.id,
      numGuia,
      numRemision: row.numRemision,
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      direccion: row.direccion,
      producto: row.producto,
      montoCobrar: row.montoCobrar,
      tiendaNombre: row.tiendaNombre,
      zonaNombre: row.zonaNombre,
      provinciaNombre: row.provinciaNombre,
      cantonNombre: row.cantonNombre,
      distritoNombre: row.distritoNombre,
      qrValue: String(numGuia), // R7: QR codifica num_guia (UNIQUE en orden)
      barcodeValue: String(numGuia), // R8: barcode codifica num_guia
    };
  }
}
