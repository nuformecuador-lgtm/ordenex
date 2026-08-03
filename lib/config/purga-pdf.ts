// Feature 178 (R1-R4, R21) — configuracion del cron diario de purga de los PDF de
// cargas antiguas. Espejo de `lib/config/jobs.ts` en el estilo (env con default, valor
// invalido -> default), con DOS diferencias deliberadas:
//
//  1. La retencion usa `readNonNegativeInt`, no el `readPositiveInt` copiado en
//     `lib/config/jobs.ts` / `lib/config/etiquetas.ts`: aquel rechaza el `0` y lo manda
//     al default, lo que contradiria R3 (`0` es un valor VALIDO: purga tambien lo creado
//     el mismo dia). Ademas ninguna de las dos copias esta exportada.
//  2. Este modulo NO exporta ningun singleton ya resuelto (a diferencia de
//     `etiquetasConfig` en `lib/config/etiquetas.ts:102`). R4 exige que la ventana se
//     resuelva EN CADA CORRIDA: el proceso de una funcion serverless sobrevive entre
//     invocaciones, asi que un valor congelado al importar dejaria dos corridas con
//     configuracion distinta usando la misma ventana.
//
// El secreto de autorizacion NO vive aqui: se reutiliza `CRON_SECRET` via
// `loadCronConfig()` (no se anade env de secreto nueva).

/**
 * Lee un entero NO NEGATIVO de `process.env`.
 * Ausente / vacia / no entera / **negativa** -> `fallback` (R2); `>= 0` -> el valor
 * tal cual (R3). Sin clamp superior: a diferencia del TTL de una URL firmada, un
 * valor absurdamente grande aqui no abre ningun dato, solo hace que no se purgue nada.
 */
function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido/`<= 0` -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Retencion por defecto, en dias (R2). */
const DEFAULT_PURGA_PDF_RETENCION_DIAS = 7;
/** Tope de cargas procesadas por corrida por defecto (R21). */
const DEFAULT_PURGA_PDF_MAX_CARGAS_POR_CORRIDA = 200;

export interface PurgaPdfConfig {
  /**
   * Dias de retencion de los PDF de una carga (R1-R3). Default 7. Minimo 0.
   * **SIN tope superior.** Con `0` el corte es el instante de la corrida y se purga
   * tambien lo creado ese mismo dia (consecuencia declarada en `requirements.md`).
   */
  PURGA_PDF_RETENCION_DIAS: number;
  /**
   * Tope de cargas procesadas en una misma corrida (R21). Default 200.
   * Semantica POSITIVA a proposito: un tope de `0` no purgaria nunca nada, asi que
   * `0`, negativos e invalidos caen al default.
   */
  PURGA_PDF_MAX_CARGAS_POR_CORRIDA: number;
}

/**
 * Resuelve la configuracion de la purga LEYENDO `process.env` en cada llamada (R4).
 * Debe invocarse dentro del handler de cada corrida, nunca al importar el modulo.
 */
export function loadPurgaPdfConfig(): PurgaPdfConfig {
  return {
    PURGA_PDF_RETENCION_DIAS: readNonNegativeInt(
      "PURGA_PDF_RETENCION_DIAS",
      DEFAULT_PURGA_PDF_RETENCION_DIAS,
    ),
    PURGA_PDF_MAX_CARGAS_POR_CORRIDA: readPositiveInt(
      "PURGA_PDF_MAX_CARGAS_POR_CORRIDA",
      DEFAULT_PURGA_PDF_MAX_CARGAS_POR_CORRIDA,
    ),
  };
}
