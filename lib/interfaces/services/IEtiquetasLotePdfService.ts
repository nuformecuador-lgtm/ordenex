import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 112 (T2.1) — contrato del orquestador que genera el PDF consolidado del
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

export interface IEtiquetasLotePdfService {
  /**
   * R1-R11/R14: para las ordenes creadas del lote, arma las etiquetas imprimibles,
   * genera un unico PDF consolidado, lo sube al bucket privado con
   * `contentType: "application/pdf"` y devuelve su URL firmada. Devuelve `null` si
   * no hay etiqueta imprimible (todas omitidas por `sin_guia`/`no_encontrada`, R14)
   * o si el servicio de etiquetas responde `forbidden`. NO captura errores de
   * infraestructura: los propaga para que el borde aplique best-effort (R12).
   */
  generarYAlmacenar(
    ordenIds: string[],
    actor: Actor,
  ): Promise<EtiquetasLotePdfResultado | null>;
}
