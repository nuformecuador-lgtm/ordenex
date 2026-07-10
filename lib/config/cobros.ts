// Configuracion del CRUD de cobros. Sobreescribible por variable de entorno
// para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode de
// contexto"), patron de lib/config/ordenes.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CobrosConfig {
  /** Tamano de pagina por defecto del listado. */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R18). */
  MAX_PAGE_SIZE: number;
}

export function loadCobrosConfig(): CobrosConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("COBROS_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("COBROS_MAX_PAGE_SIZE", 100),
  };
}

export const cobrosConfig: CobrosConfig = loadCobrosConfig();
