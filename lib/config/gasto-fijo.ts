// Feature 170 (T H.1, R40) — configuracion del dominio "gasto fijo". Sobreescribible por
// variable de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin
// hardcode de contexto"), patron de lib/config/usuarios.ts.
//
// Cubre el listado de PLANTILLAS de gasto fijo (`GastoFijoPlantillaService`), el unico del
// Anexo III de este dominio. Es un punado de filas y se pagina por uniformidad, no por
// volumen (design §11.3, riesgo BAJO): el valor de tener config propia es que el dia que
// crezca no haya que decidir nada, y que la pantalla no invente un literal.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface GastoFijoConfig {
  /** Tamano de pagina por defecto del listado de plantillas de gasto fijo (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadGastoFijoConfig(): GastoFijoConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("GASTO_FIJO_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("GASTO_FIJO_MAX_PAGE_SIZE", 100),
  };
}

export const gastoFijoConfig: GastoFijoConfig = loadGastoFijoConfig();
