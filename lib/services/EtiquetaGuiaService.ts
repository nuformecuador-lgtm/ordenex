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

export class EtiquetaGuiaService implements IEtiquetaGuiaService {
  constructor(private readonly repo: IOrdenRepository) {}

  async generarEtiquetas(
    input: GenerarEtiquetasInput,
    _actor: Actor,
  ): Promise<GenerarEtiquetasServiceResult> {
    // Autorizacion: la etiqueta es un READ derivado disponible para cualquier rol
    // autenticado (decision del usuario). La sesion ya se exige en el borde
    // (Server Action -> `unauthenticated` sin sesion); aqui no se restringe por rol
    // ni se filtra por visibilidad de la orden.
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
      if (!row) {
        // No existe o esta borrada (el repo la excluyo por deletedAt) (R3).
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
    _actor: Actor,
  ): Promise<EtiquetaPorGuiaServiceResult> {
    // Misma autorizacion que `generarEtiquetas`: READ derivado disponible para
    // cualquier rol autenticado (la sesion se exige en el borde).
    const row = await this.repo.findEtiquetaByNumGuia(numGuia); // ya filtra borradas (R3)
    if (!row || row.numGuia === null) return { status: "no_encontrada" };
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
