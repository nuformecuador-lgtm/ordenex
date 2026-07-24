// Feature 112 — Configuracion del PDF consolidado de etiquetas de guia generado
// tras la carga por API. Sin hardcode de contexto (docs/architecture.md, R18):
// el nombre del bucket privado y el TTL de la URL firmada se resuelven por
// variable de entorno con un valor por defecto (patron de lib/config/gestion.ts).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface EtiquetasConfig {
  /** Nombre del bucket PRIVADO de Supabase Storage para los PDF de etiquetas (R8/R9). */
  ETIQUETAS_BUCKET: string;
  /** TTL (segundos) de la URL firmada del PDF del lote (R10). Default 3600 (1 h). */
  SIGNED_URL_TTL_SECONDS: number;
}

export function loadEtiquetasConfig(): EtiquetasConfig {
  return {
    ETIQUETAS_BUCKET: process.env.ETIQUETAS_BUCKET?.trim() || "etiquetas-guia",
    SIGNED_URL_TTL_SECONDS: readPositiveInt("ETIQUETAS_SIGNED_URL_TTL_SECONDS", 3600),
  };
}

export const etiquetasConfig: EtiquetasConfig = loadEtiquetasConfig();
