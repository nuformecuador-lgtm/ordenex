import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 177 (design §4.1/§6) — contrato del service de PDF de etiquetas del canal
// integrador (API por key). Resuelve SIEMPRE el recurso con el owner forzado
// (`actor.usuarioId`, R4) ANTES de llamar al generador de la 136, que NO filtra por
// visibilidad (`IEtiquetaGuiaService.ts:38`). Sin acoplarse a HTTP: el borde traduce
// cada `status` a su Response (`not_found` -> 404, `sin_etiqueta`/`excede_tope` -> 409).

export type PdfEtiquetaResult =
  /**
   * R22: URL firmada EN ESTA llamada (nunca leida de la persistencia, R23) y su TTL.
   *
   * YA NO LLEVA `generado`. Aqui vivia el testigo del reuso (`false` = se re-firmo el objeto
   * existente, `true` = se construyo y subio). Se retiro del contrato el 2026-08-25: para el
   * integrador el resultado util es IDENTICO en los dos casos —una URL firmada del mismo PDF—,
   * asi que el campo no habilitaba ninguna decision suya y si describia nuestro estado interno
   * de almacenamiento (si el objeto ya estaba en el bucket). El reuso sigue existiendo tal cual
   * (R21/R31): lo que se retira es contarlo, no hacerlo.
   */
  | { status: "ok"; url: string; expiraEnSegundos: number }
  /** R12/R29: recurso inexistente, borrado o de otro owner. El borde -> 404 identico. */
  | { status: "not_found" }
  /** R25/R33: sin etiqueta imprimible (orden sin guia / lote sin ninguna). -> 409. */
  | { status: "sin_etiqueta" }
  /** R34: el lote supera `MAX_ETIQUETAS_POR_PDF`; se corta ANTES de construir. -> 409. */
  | { status: "excede_tope" };

export interface IApiPdfEtiquetaService {
  /**
   * R20/R21/R22/R25: PDF de la etiqueta de UNA orden propia. Si la orden ya tiene
   * referencia persistida (`download_storage_path`), solo re-firma; si no, genera,
   * sube y persiste SOLO esa columna. Nunca lee ni escribe `download_url` (R37/R38).
   */
  porOrden(actor: Actor, ordenId: string): Promise<PdfEtiquetaResult>;
  /**
   * R29/R30/R31/R33/R34: PDF consolidado de una carga propia, con las ordenes vivas del
   * owner que devuelve el repositorio (R32). Misma semantica de reuso que `porOrden`.
   */
  porCarga(actor: Actor, cargaId: string): Promise<PdfEtiquetaResult>;
}
