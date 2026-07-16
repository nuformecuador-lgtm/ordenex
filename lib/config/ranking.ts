// Feature 76 (R7/R22) — configuracion del umbral minimo de muestra para entrar al PODIO
// del ranking diario (posiciones 1-3). Sobreescribible por variable de entorno para no
// hardcodear el contexto (docs/architecture.md "Sin hardcode de contexto"), espejo de
// lib/config/reintentos.ts. Un mensajero con menos asignaciones HOY que este umbral se
// LISTA pero NO ocupa podio (R7). Un valor invalido/ausente cae al default 1.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RankingConfig {
  /** Minimo de ordenes asignadas HOY para poder ocupar el podio (1-3). Default 1. */
  MIN_ASIGNADAS_PODIO: number;
}

export function loadRankingConfig(): RankingConfig {
  return { MIN_ASIGNADAS_PODIO: readPositiveInt("RANKING_MIN_ASIGNADAS", 1) };
}

export const rankingConfig: RankingConfig = loadRankingConfig();
