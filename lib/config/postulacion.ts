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
    BUCKET: process.env.POSTULACION_BUCKET?.trim() || "mensajero-docs",
    RATE_MAX: readPositiveInt("POSTULACION_RATE_MAX", 3),
    RATE_WINDOW_MINUTES: readPositiveInt("POSTULACION_RATE_WINDOW_MINUTES", 60),
  };
}

export const postulacionConfig: PostulacionConfig = loadPostulacionConfig();
