// Configuracion del CRUD de plantillas (feature 107). Sobreescribible por variable de
// entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode de
// contexto"), patron de lib/config/usuarios.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface PlantillasConfig {
  /** Tamano de pagina por defecto del listado (R7). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R7). */
  MAX_PAGE_SIZE: number;
}

export function loadPlantillasConfig(): PlantillasConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("PLANTILLAS_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("PLANTILLAS_MAX_PAGE_SIZE", 100),
  };
}

export const plantillasConfig: PlantillasConfig = loadPlantillasConfig();
