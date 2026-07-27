import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 136 (T2.1) — contrato del orquestador que genera el PDF consolidado del
// lote y lo almacena en el bucket privado, devolviendo su URL firmada. Logica de
// negocio pura (sin HTTP): el borde (endpoint de carga por API) decide la politica
// best-effort (try/catch) y traduce el resultado al bloque `etiquetasPdf`.

export interface EtiquetasLotePdfResultado {
  /** Path del objeto dentro del bucket privado (aislado por dueño, R11). */
  path: string;
  /** URL firmada del PDF, valida por `expiraEnSegundos` (R10). */
  signedUrl: string;
  /** TTL en segundos de la URL firmada (R10). */
  expiraEnSegundos: number;
}

/**
 * Feature 141 (R48) — resultado del modo `individual`: UN PDF (de una sola etiqueta) por
 * orden, con su URL firmada. Se correlaciona por `ordenId` para persistir cada URL en el
 * `orden.download_url` de SU orden.
 */
export interface EtiquetaOrdenPdfResultado {
  ordenId: string;
  /** Path del objeto dentro del bucket privado (aislado por dueño). */
  path: string;
  /** URL firmada del PDF de ESA orden. */
  signedUrl: string;
  /** TTL en segundos de la URL firmada. */
  expiraEnSegundos: number;
}

export interface IEtiquetasLotePdfService {
  /**
   * R1-R11/R14: para las ordenes creadas del lote, arma las etiquetas imprimibles,
   * genera un unico PDF consolidado, lo sube al bucket privado con
   * `contentType: "application/pdf"` y devuelve su URL firmada. Devuelve `null` si
   * no hay etiqueta imprimible (todas omitidas por `sin_guia`/`no_encontrada`, R14)
   * o si el servicio de etiquetas responde `forbidden`. NO captura errores de
   * infraestructura: los propaga para que el borde aplique best-effort (R12).
   * Tampoco genera PDFs por encima del tope de etiquetas configurado: lanza
   * `EtiquetasLoteExcedeTopeError` antes de construir nada (BLOQ-1).
   */
  generarYAlmacenar(
    ordenIds: string[],
    actor: Actor,
  ): Promise<EtiquetasLotePdfResultado | null>;

  /**
   * Feature 141/R48/R49/R52 — modo `individual`: UN PDF por orden con etiqueta imprimible.
   * Resuelve las etiquetas con UNA sola llamada a `generarEtiquetas` (sin N+1) y, por cada
   * una, construye un PDF de una pagina, lo sube al bucket privado y firma su URL. Las
   * ordenes sin etiqueta imprimible (`sin_guia` / `no_encontrada`) simplemente NO aparecen en
   * el resultado, sin abortar las demas (R49); `forbidden`, lista vacia o cero etiquetas
   * devuelven `[]` sin tocar Storage (R50). Aplica el MISMO tope que el consolidado ANTES de
   * construir nada (`EtiquetasLoteExcedeTopeError`, R52). NO captura errores de
   * infraestructura: los propaga para que el borde aplique best-effort (R51).
   */
  generarYAlmacenarPorOrden(
    ordenIds: string[],
    actor: Actor,
  ): Promise<EtiquetaOrdenPdfResultado[]>;
}
