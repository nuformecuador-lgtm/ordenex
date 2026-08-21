// Configuracion de la postulacion de mensajero (feature 21). Sobreescribible por
// variable de entorno para no hardcodear cotas de negocio (docs/architecture.md:
// "Sin hardcode de contexto"), patron de lib/config/auth.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Tipos MIME de imagen aceptados para los documentos (A2/R10). */
export const POSTULACION_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type PostulacionMimeType = (typeof POSTULACION_ALLOWED_MIME)[number];

/** Extension de archivo por tipo MIME, para construir el storage_path (R16). */
export const MIME_EXTENSION: Record<PostulacionMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface PostulacionConfig {
  /** Tamano maximo por documento en bytes (A2/R10). Default 5 MB. */
  MAX_FILE_BYTES: number;
  /**
   * Presupuesto del CUERPO de la peticion para la SUMA de los 5 documentos, en
   * bytes. Default 4 MB.
   *
   * DE DONDE SALE EL NUMERO:
   *   techo del transporte = `experimental.serverActions.bodySizeLimit` de
   *                          next.config.ts = "5mb" = 5 * 1024 * 1024
   *                          = 5.242.880 B, y ese techo es para TODA la
   *                          peticion, no por archivo.
   *   overhead del multipart = 16 partes (11 campos de texto + 5 archivos).
   *                          Cada parte gasta boundary (~70 B) + las cabeceras
   *                          Content-Disposition/Content-Type + CRLF, ~200 B
   *                          por parte => ~3,2 KB. Los valores de texto
   *                          (nombre, correo, clave...) suman < 1 KB, y Next
   *                          agrega ademas su propio campo con el id de la
   *                          Server Action. Contado con holgura: ~10 KB.
   *   margen               = todo el resto, ~1 MB (20 %).
   *   presupuesto          = 4 * 1024 * 1024 = 4.194.304 B.
   *
   * El margen es MUCHO mayor que el overhead calculado, y es deliberado: la
   * decision es ASIMETRICA. Pasarse del techo del transporte es un fallo MUDO
   * -- Next corta antes de que corra el codigo de la app, sin log, sin 4xx y
   * sin respuesta util; ese es exactamente el defecto que esto arregla --,
   * mientras que pasarse de ESTE presupuesto es un fallo RUIDOSO que la
   * pantalla explica con el peso real y el maximo. Como no esta documentado
   * como contabiliza Next los bytes exactos ni se puede medir en CI, se
   * prefiere fallar del lado ruidoso. Para el caso normal sobra: cinco fotos
   * pasadas por `comprimirImagen` pesan ~200-600 KB cada una (~3 MB en total).
   */
  MAX_TOTAL_BYTES: number;
  /** Nombre del bucket privado de Supabase Storage (A2/R18). */
  BUCKET: string;
  /** Maximo de postulaciones por clave IP|email dentro de la ventana (A4). */
  RATE_MAX: number;
  /** Ventana en minutos del limitador de la accion publica (A4). */
  RATE_WINDOW_MINUTES: number;
}

export function loadPostulacionConfig(): PostulacionConfig {
  return {
    MAX_FILE_BYTES: readPositiveInt("POSTULACION_MAX_FILE_BYTES", 5 * 1024 * 1024),
    MAX_TOTAL_BYTES: readPositiveInt("POSTULACION_MAX_TOTAL_BYTES", 4 * 1024 * 1024),
    BUCKET: process.env.POSTULACION_BUCKET?.trim() || "mensajero-docs",
    RATE_MAX: readPositiveInt("POSTULACION_RATE_MAX", 3),
    RATE_WINDOW_MINUTES: readPositiveInt("POSTULACION_RATE_WINDOW_MINUTES", 60),
  };
}

export const postulacionConfig: PostulacionConfig = loadPostulacionConfig();
