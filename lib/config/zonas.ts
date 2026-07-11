// Feature 24. Configuracion del CRUD de zonas. Sobreescribible por variable de
// entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode
// de contexto"), patron de lib/config/cobros.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ZonasConfig {
  /** Tamano de pagina por defecto del listado. */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R24). */
  MAX_PAGE_SIZE: number;
}

export function loadZonasConfig(): ZonasConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("ZONAS_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("ZONAS_MAX_PAGE_SIZE", 100),
  };
}

export const zonasConfig: ZonasConfig = loadZonasConfig();
