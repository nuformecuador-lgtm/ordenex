import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 141 (design §6.3) — contrato del orquestador de la DESCARGA de etiquetas de un
// lote: genera los PDFs segun el modo pedido y PERSISTE la URL resultante donde corresponde
// (`carga.download_url` en `consolidate`, `orden.download_url` en `individual`). Existe
// porque el borde HTTP no puede hablar con el repositorio (regla de capas) y la 136 dejaba
// esa orquestacion en la ruta. Logica de negocio pura: sin Request/Response.

/** Modo de descarga pedido por el integrador (`download_type`, R42/R43). NO se persiste (R45). */
export type DownloadType = "consolidate" | "individual";

export interface EtiquetasDescargaResultado {
  /** Modo `consolidate` (R47/R53): PDF unico del lote. `null` si no se genero ninguno. */
  consolidado: { url: string; expiraEnSegundos: number } | null;
  /** Modo `individual` (R48/R54): `ordenId` -> URL de SU PDF. Vacio si no se genero ninguno. */
  porOrden: Map<string, string>;
}

export interface IEtiquetasDescargaService {
  /**
   * R47-R50: genera las etiquetas del lote segun `modo` y persiste las URLs.
   * - `ordenIds` vacio -> no toca Storage ni DB y devuelve el resultado vacio (R50).
   * - `consolidate` -> UN PDF; su URL va a `carga.download_url` (si hay `cargaId`).
   * - `individual`  -> UN PDF por orden; cada URL va al `orden.download_url` de su orden.
   * NO captura errores (los propaga): la politica best-effort vive en el borde (R51), igual
   * que en la feature 136.
   */
  generarYPersistir(params: {
    modo: DownloadType;
    cargaId: string | null;
    ordenIds: string[];
    actor: Actor;
  }): Promise<EtiquetasDescargaResultado>;
}
