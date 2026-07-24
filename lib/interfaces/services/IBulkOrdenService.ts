import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type { BulkSummary, RowResult } from "@/lib/types/carga-masiva";

// R11: resultado discriminado. La autorizacion NO lanza; el borde (Route
// Handler) traduce "forbidden" a un AppErrorShape (feature 10).
export type BulkOrdenResult = { status: "ok"; summary: BulkSummary } | { status: "forbidden" };

// Feature 88/R10 — fila del resultado de la carga por API. Extiende `RowResult` (misma
// clasificacion creada/duplicada/error de la carga masiva) SOLO añadiendo `numGuia` a las
// filas `creada` (las duplicadas/error no consumen guia, R11).
export interface CargaViaApiRow extends RowResult {
  numGuia?: number;
}

// Feature 88/R10 — bloque plano que el integrador consume directo (sin filtrar `filas`):
// una entrada por orden EFECTIVAMENTE creada, con su `numGuia` e `id`.
export interface CargaViaApiOrden {
  id: string;
  numRemision: string;
  numGuia: number;
  estado: string;
  // Feature 98 (design §2, R5/R7/D2/D3): costo del envio que paga la tienda por esta orden =
  // FLETE + IVA del flete de su tarifa vigente, money-safe STRING escala 2. NUNCA `null`: el
  // gap de tarifa (tienda sin tarifa vigente) se representa con "0.00" (D1). Distinto de
  // `monto_cobrar`/COD (que viaja en el input y no se toca).
  costoEnvio: string;
}

export interface CargaViaApiSummary {
  total: number;
  creadas: number;
  duplicadas: number;
  conError: number;
  filas: CargaViaApiRow[];
  ordenes: CargaViaApiOrden[];
}

// Feature 88 — resultado discriminado de la carga por API (espejo de `BulkOrdenResult`):
// la autorizacion (rol `apiKey`) NO lanza; el borde traduce `forbidden` a 403.
export type CargaViaApiResult =
  | { status: "ok"; summary: CargaViaApiSummary }
  | { status: "forbidden" };

export interface IBulkOrdenService {
  /**
   * Procesa las filas ya parseadas de un archivo de carga masiva: autoriza
   * (SOLO adminTienda, R11), resuelve/valida cada fila (R18-R23), deduplica
   * (R25/R26), persiste en lotes (R27) con exito parcial (R29) y arma el
   * resumen (R30). Nunca lanza por autorizacion; SI puede lanzar por fallos
   * inesperados de infraestructura (el borde los normaliza a INTERNAL).
   *
   * `options.dryRun` (validación previa): ejecuta TODA la resolución/validación
   * y clasificación de filas (geografía, duplicados, mensajero) SIN persistir
   * ninguna orden. Devuelve el mismo `BulkSummary` que la carga real, para que
   * la UI muestre los hallazgos (errores de geografía, num_remision duplicados)
   * ANTES de escribir en la DB. La carga real re-valida (es la autoridad final).
   */
  cargarMasiva(
    rows: RawRow[],
    actor: Actor,
    options?: { dryRun?: boolean },
  ): Promise<BulkOrdenResult>;

  /**
   * Feature 88 — carga por API (canal integrador). Reusa los helpers de resolucion/dedup/
   * validacion de `cargarMasiva` (R7), pero: autoriza SOLO al rol `apiKey` (R15); el dueño
   * (`tienda_id`) es el usuario dedicado de la key (`actor.usuarioId`, D4); el estado inicial
   * es FIJO `en_ruta_bodega_central` (R8, sin consultar el flag `fulfillment`); y persiste
   * con `num_guia` inmediato (R9). Nunca lanza por autorizacion (devuelve `forbidden`).
   * Devuelve el summary extendido con `numGuia` por creada + el bloque plano `ordenes` (R10).
   * No hay `dryRun`: el integrador carga en firme.
   */
  cargarViaApi(rows: RawRow[], actor: Actor): Promise<CargaViaApiResult>;
}
