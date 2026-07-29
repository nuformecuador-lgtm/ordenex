// Feature 151 (design.md §4.3/§6) — tope duro de filas de la descarga de datasets.
// Config, no literal, por la regla "sin hardcode de contexto" de docs/architecture.md;
// mismo patron `readPositiveInt` que lib/config/ordenes.ts.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface DescargaConfigEnv {
  /**
   * R19/R20: maximo de filas que una descarga puede producir. Superarlo es un ERROR
   * accionable, nunca un truncado silencioso (R21). Default 5000 (gate F1.4, P1).
   */
  MAX_FILAS: number;
}

export function loadDescargaConfig(): DescargaConfigEnv {
  return {
    MAX_FILAS: readPositiveInt("DESCARGA_MAX_FILAS", 5000),
  };
}

export const descargaConfig: DescargaConfigEnv = loadDescargaConfig();
