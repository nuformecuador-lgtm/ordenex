// Configuracion del modulo "Cierre del dia" (feature 37). Sobreescribible por
// variable de entorno para no hardcodear cotas de contexto (docs/architecture.md:
// "Sin hardcode de contexto"), patron lib/config/gestion.ts. El bucket de las
// evidencias es el MISMO de la feature 36 (las evidencias son las de gestion_orden);
// se reusa `gestionConfig.EVIDENCIA_BUCKET` en el borde para firmar.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CierreConfig {
  /** TTL (segundos) de la URL firmada de una evidencia al listar (R5). Default 5 min. */
  SIGNED_URL_TTL_SECONDS: number;
}

export function loadCierreConfig(): CierreConfig {
  return {
    SIGNED_URL_TTL_SECONDS: readPositiveInt("CIERRE_SIGNED_URL_TTL_SECONDS", 5 * 60),
  };
}

export const cierreConfig: CierreConfig = loadCierreConfig();
