// FICHA 401 (design §6.4, R29/R30) — los CINCO numeros de la salud del geocodificador.
//
// POR QUE UN MODULO PROPIO Y NO DENTRO DE `GeocodeConfig`. `GeocodeConfig` se le pasa a
// `GeocodificacionService` y lo construyen A MANO decenas de tests; anadirle cinco campos
// obligatorios los rompe a todos por una ficha que no les concierne. Este modulo lo consume
// SOLO `GeocodeSaludService`, y por eso `lib/config/geocode.ts` no se toca (R28).
//
// CLON ESTRUCTURAL de `lib/config/jobs.ts`: ausente, vacio, no numerico, cero o negativo ->
// default, y `loadGeocodeSaludConfig()` NUNCA lanza (R30). Es deliberado y no es simetria: esto
// se carga dentro de la corrida del drenador, que sirve a nueve tipos de job; una excepcion al
// CARGAR la configuracion tumbaria la corrida entera por una cifra mal escrita en un `.env`.

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido/<=0 -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface GeocodeSaludConfig {
  /**
   * Cuantos jobs DISTINTOS con el marcador hacen falta para considerar la caida. Default 3.
   *
   * JOBS, NO INTENTOS (design §4.3): un solo job reintenta hasta 8 veces con backoff
   * 1-2-4-8-16-32-60 min, asi que contando intentos UNA sola orden cruzaria un umbral de 3 en
   * tres minutos — el «fallo aislado» que R4 prohibe avisar.
   */
  GEOCODE_CAIDA_JOBS_MINIMOS: number;
  /**
   * Ventana de RECENCIA en minutos dentro de la que se cuentan esos jobs. Default 60.
   *
   * El suelo NO es arbitrario: el backoff de la cola topa en `JOBS_BACKOFF_CAP_MS` (60 min), asi
   * que un job aun vivo por esta causa refresca su `updated_at` como mucho cada 60 minutos. Una
   * ventana mas corta perderia de la cuenta jobs que siguen fallando.
   */
  GEOCODE_CAIDA_VENTANA_MIN: number;
  /** Maximo de jobs devueltos a la cola por cada respuesta satisfactoria. Default 5 (R21). */
  GEOCODE_RECUPERACION_LOTE: number;
  /**
   * Separacion en ms entre los `run_after` de una misma tanda. Default 60000 (R22).
   *
   * Es EXACTAMENTE el intervalo del cron (`* * * * *`): con el escalonado, como mucho UNO de la
   * tanda es reclamable en cada corrida de 10, y los otros ocho tipos de job conservan su turno.
   */
  GEOCODE_RECUPERACION_ESPACIADO_MS: number;
  /**
   * Enfriamiento en minutos: un job no se vuelve a revivir antes de eso. Default 60 (R24).
   *
   * Es la RED, no el argumento principal: un proveedor intermitente no puede hacer reintentar un
   * mismo job sin fin. Techo duro: <=1 llamada pagada por job y por hora.
   */
  GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN: number;
}

export function loadGeocodeSaludConfig(): GeocodeSaludConfig {
  return {
    GEOCODE_CAIDA_JOBS_MINIMOS: readPositiveInt("GEOCODE_CAIDA_JOBS_MINIMOS", 3),
    GEOCODE_CAIDA_VENTANA_MIN: readPositiveInt("GEOCODE_CAIDA_VENTANA_MIN", 60),
    GEOCODE_RECUPERACION_LOTE: readPositiveInt("GEOCODE_RECUPERACION_LOTE", 5),
    GEOCODE_RECUPERACION_ESPACIADO_MS: readPositiveInt("GEOCODE_RECUPERACION_ESPACIADO_MS", 60_000),
    GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN: readPositiveInt(
      "GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN",
      60,
    ),
  };
}
