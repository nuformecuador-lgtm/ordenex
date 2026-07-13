// Feature 47 (R3) — configuracion del umbral de reintentos de entrega. Sobreescribible
// por variable de entorno para no hardcodear la cota legal (docs/architecture.md: "Sin
// hardcode de contexto"), espejo de lib/config/ordenes.ts. El "minimo por ley" (default 3)
// se sube via env sin tocar codigo; un valor invalido/ausente cae al default.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ReintentosConfig {
  /** Minimo de intentos de entrega por ley antes de escalar a rechazo. Default 3. */
  MIN_INTENTOS_ENTREGA: number;
}

export function loadReintentosConfig(): ReintentosConfig {
  return { MIN_INTENTOS_ENTREGA: readPositiveInt("REINTENTOS_MIN_INTENTOS", 3) };
}

export const reintentosConfig: ReintentosConfig = loadReintentosConfig();
