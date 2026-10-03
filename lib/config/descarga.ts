// Feature 151 (design.md §4.3/§6) — tope duro de filas de la descarga de datasets.
// Ficha 470 (design §3.1, R1/R3/R5/R10/R17) — el tope YA NO ES CONFIGURABLE: vale el limite de
// Excel. Antes era `DESCARGA_MAX_FILAS` (default 5000) y existia porque el conjunto completo viajaba
// en la respuesta de una Server Action (Vercel corta a 4,5 MB). Desde la 470 los conjuntos grandes
// viajan por un objeto temporal en Storage (umbral `UMBRAL_ALMACEN_BYTES`), asi que el unico maximo
// que queda es el de la hoja de Excel. NO se lee de entorno a proposito (R3): si produccion tuviera
// `DESCARGA_MAX_FILAS=5000` definido, leerlo dejaria el fallo intacto sin ninguna señal.
//
// Este modulo tambien se importa en el cliente (`components/shared/descarga-resultado.ts`): alli las
// env no existen y rigen los defaults, que es lo correcto (el cliente solo usa `MAX_FILAS`).

/** Excel: 1.048.576 filas por hoja, cabecera incluida ⇒ 1.048.575 filas de datos. */
export const EXCEL_MAX_FILAS_DATOS = 1_048_575;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonEmpty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === "" ? fallback : trimmed;
}

export interface DescargaConfigEnv {
  /**
   * Maximo de filas que una descarga puede producir = limite de Excel (R1). FIJO: ignora
   * `DESCARGA_MAX_FILAS` (R3). Superarlo sigue siendo un ERROR accionable, nunca un truncado.
   */
  MAX_FILAS: number;
  /**
   * R5/R6: bytes del conjunto serializado por encima de los cuales NO viaja en la respuesta de la
   * accion sino como objeto temporal en Storage. Env `DESCARGA_UMBRAL_ALMACEN_BYTES`, default 2 MB
   * (el cuerpo de una Server Action lleva sobrecoste de React frente al limite de 4,5 MB de Vercel).
   */
  UMBRAL_ALMACEN_BYTES: number;
  /** R10: caducidad de la URL firmada del objeto temporal. Env `DESCARGA_TTL_URL_SEGUNDOS`, default 300. */
  TTL_URL_SEGUNDOS: number;
  /** R17: edad a partir de la cual la purga borra un objeto temporal. Env `DESCARGA_RETENCION_MINUTOS`, default 60. */
  RETENCION_MINUTOS: number;
  /** R9: bucket PRIVADO de los objetos temporales. Env `DESCARGAS_BUCKET`, default "descargas". */
  BUCKET: string;
}

export function loadDescargaConfig(): DescargaConfigEnv {
  return {
    MAX_FILAS: EXCEL_MAX_FILAS_DATOS,
    UMBRAL_ALMACEN_BYTES: readPositiveInt("DESCARGA_UMBRAL_ALMACEN_BYTES", 2_000_000),
    TTL_URL_SEGUNDOS: readPositiveInt("DESCARGA_TTL_URL_SEGUNDOS", 300),
    RETENCION_MINUTOS: readPositiveInt("DESCARGA_RETENCION_MINUTOS", 60),
    BUCKET: readNonEmpty("DESCARGAS_BUCKET", "descargas"),
  };
}

export const descargaConfig: DescargaConfigEnv = loadDescargaConfig();
