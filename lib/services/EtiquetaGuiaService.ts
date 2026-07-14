// Feature 32 — Orquesta "Etiqueta de guia": READ derivado que arma el payload de
// etiqueta (QR + codigo de barras + datos) por cada orden con `num_guia`. Sin
// tabla ni migracion nueva. Servicio dedicado, separado de OrdenService (CRUD):
// ensambla nombres de geografia/tienda y decide QR/barcode en un solo lugar, algo
// que no encaja en el `obtener`/`listar` generico (design.md §3, alternativa C
// descartada). No conoce HTTP ni Prisma directamente (DI por constructor).
import type { EtiquetaRow, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
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
      // La orden existe: se genera etiqueta tenga o no guia. Sin guia, el QR
      // (=ordenId) sigue siendo valido; el barcode queda null y la UI lo omite.
      etiquetas.push(this.toEtiquetaDTO(row));
    }

    return { status: "ok", etiquetas, omitidas };
  }

  // R1/R4/R5/R6/R7: arma el DTO de una orden. `numGuia` puede ser null (orden aun
  // sin guia). montoCobrar es number|null sin moneda (R5); distritoNombre null si no
  // hay (R4); qrValue = ordenId (R7, siempre presente); barcodeValue = String(numGuia)
  // o null si no hay guia (la UI omite el barcode). No expone deletedAt (R6): la fila
  // ni siquiera lo trae.
  private toEtiquetaDTO(row: EtiquetaRow): EtiquetaGuiaDTO {
    return {
      ordenId: row.id,
      numGuia: row.numGuia,
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
      qrValue: row.id, // R7: QR codifica orden.id (UUID estable, feature 33)
      barcodeValue: row.numGuia === null ? null : String(row.numGuia),
    };
  }
}
