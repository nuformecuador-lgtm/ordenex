// Feature 15 — Configuracion de la carga masiva. Sobreescribible por variable
// de entorno, patron lib/config/ordenes.ts (docs/architecture.md: "sin hardcode
// de contexto"). El default de estatus NO vive aqui: se toma de
// ordenesConfig.DEFAULT_ESTATUS_VALUE (global, ver lib/config/ordenes.ts).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CargaMasivaConfig {
  /** Tamano maximo del archivo en bytes, rechazado antes de parsear (R28). */
  MAX_FILE_BYTES: number;
  /** Numero maximo de filas de datos permitidas por archivo (R28). */
  MAX_ROWS: number;
  /** Tamano de lote para la insercion masiva (R27). */
  BATCH_SIZE: number;
}

export function loadCargaMasivaConfig(): CargaMasivaConfig {
  return {
    MAX_FILE_BYTES: readPositiveInt("CARGA_MASIVA_MAX_FILE_BYTES", 5 * 1024 * 1024),
    MAX_ROWS: readPositiveInt("CARGA_MASIVA_MAX_ROWS", 5000),
    BATCH_SIZE: readPositiveInt("CARGA_MASIVA_BATCH_SIZE", 500),
  };
}

export const cargaMasivaConfig: CargaMasivaConfig = loadCargaMasivaConfig();
