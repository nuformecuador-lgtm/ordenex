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
  /**
   * Tope duro de filas de datos por carga. El archivo se parsea en el navegador
   * y, si lo supera, se ALERTA sin procesar (nunca llega al servidor). El backend
   * ya no recibe el archivo entero: las filas viajan como JSON en lotes (chunks),
   * por lo que este tope protege memoria del navegador y volumen de la carga.
   */
  MAX_ROWS: number;
  /** Filas por request al validar/cargar por chunks (cada lote << 4.5MB). */
  CHUNK_SIZE: number;
  /** Tope defensivo de filas que el endpoint de chunk acepta por request. */
  MAX_CHUNK_ROWS: number;
  /** Tamano de lote para la insercion masiva en DB (R27). */
  BATCH_SIZE: number;
}

export function loadCargaMasivaConfig(): CargaMasivaConfig {
  return {
    MAX_FILE_BYTES: readPositiveInt("CARGA_MASIVA_MAX_FILE_BYTES", 50 * 1024 * 1024),
    MAX_ROWS: readPositiveInt("CARGA_MASIVA_MAX_ROWS", 50_000),
    CHUNK_SIZE: readPositiveInt("CARGA_MASIVA_CHUNK_SIZE", 2_000),
    MAX_CHUNK_ROWS: readPositiveInt("CARGA_MASIVA_MAX_CHUNK_ROWS", 5_000),
    BATCH_SIZE: readPositiveInt("CARGA_MASIVA_BATCH_SIZE", 500),
  };
}

export const cargaMasivaConfig: CargaMasivaConfig = loadCargaMasivaConfig();
