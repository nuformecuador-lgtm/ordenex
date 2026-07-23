// Configuracion del flujo de gestion del mensajero (feature 36). Sobreescribible
// por variable de entorno para no hardcodear cotas de negocio ni el nombre del
// bucket (docs/architecture.md: "Sin hardcode de contexto"), patron de
// lib/config/postulacion.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Tipos MIME de imagen aceptados para la evidencia de gestion (R24). */
export const GESTION_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type GestionMimeType = (typeof GESTION_ALLOWED_MIME)[number];

/** Extension de archivo por tipo MIME, para construir el storage_path (R23/R30). */
export const GESTION_MIME_EXTENSION: Record<GestionMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface GestionConfig {
  /** Tamano maximo por evidencia en bytes (R24). Default 5 MB. */
  MAX_FILE_BYTES: number;
  /** Nombre del bucket privado NUEVO de Supabase Storage para evidencias (R8, F1.4-f). */
  EVIDENCIA_BUCKET: string;
  /** TTL (segundos) de la URL firmada de una evidencia (R8). Default 5 min. */
  SIGNED_URL_TTL_SECONDS: number;
  /**
   * Feature 119 (R7, gate F1.4): maximo de evidencias (fotos) por gestion. Default 3,
   * sobreescribible por env `GESTION_MAX_EVIDENCIAS` (sin hardcode de cota de negocio).
   */
  MAX_EVIDENCIAS_POR_GESTION: number;
}

export function loadGestionConfig(): GestionConfig {
  return {
    MAX_FILE_BYTES: readPositiveInt("GESTION_MAX_FILE_BYTES", 5 * 1024 * 1024),
    EVIDENCIA_BUCKET: process.env.GESTION_EVIDENCIA_BUCKET?.trim() || "gestion-evidencias",
    SIGNED_URL_TTL_SECONDS: readPositiveInt("GESTION_SIGNED_URL_TTL_SECONDS", 5 * 60),
    MAX_EVIDENCIAS_POR_GESTION: readPositiveInt("GESTION_MAX_EVIDENCIAS", 3),
  };
}

export const gestionConfig: GestionConfig = loadGestionConfig();
