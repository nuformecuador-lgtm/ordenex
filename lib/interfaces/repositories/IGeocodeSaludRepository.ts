// FICHA 401 (design §5.1) — contrato ESTRECHO y PROPIO sobre la tabla `jobs`, con vocabulario
// de geocodificacion.
//
// POR QUE NO SE AMPLIA `IJobRepository` (R35). Ese es el contrato GENERICO de la cola, compartido
// por las features 90/91/92/99, y su propia documentacion se niega a crecer: la 92 rechazo
// anadirle `cancel`/`reschedule` para no tocar una interfaz compartida. Se respeta el precedente:
// esta ficha abre su propio repositorio sobre la MISMA tabla en vez de meter «revivir jobs de
// geocodificacion» en el contrato que sirve a nueve tipos de job.
//
// Las DOS sentencias que lo implementan NO son verificables con dobles (memoria del repo:
// «probar el WHERE donde vive»): se prueban contra Postgres real en
// `tests/integration/db/geocode-recuperacion.test.ts`.

export interface RevivirFallosConfigOpts {
  /** Instante inyectado de la recuperacion. Nunca `NOW()` de Postgres: tests deterministas. */
  ahora: Date;
  /** Maximo de jobs a devolver a la cola en esta tanda (R21). */
  limite: number;
  /** Separacion en ms entre los `run_after` de la tanda; el i-esimo va a `ahora + i*espaciado` (R22). */
  espaciadoMs: number;
  /** Cota de ENFRIAMIENTO (R24): solo entran jobs cuyo `updated_at` sea ANTERIOR a este instante. */
  tocadoAntesDe: Date;
}

export interface IGeocodeSaludRepository {
  /**
   * R2/R3 — cuenta jobs de geocodificacion **DISTINTOS** (no intentos), NO completados, cuyo
   * `last_error` EMPIEZA por el marcador de la ficha 400 y cuyo ultimo fallo (`updated_at`) es
   * posterior o igual a `desde`.
   *
   * ⚠️ `excluirJobId` ES EL JOB EN CURSO, Y EL MOTIVO ES UN OFF-BY-ONE REAL (design §5.3). Cuando
   * el service llama, el fallo del job en curso TODAVIA NO ESTA PERSISTIDO: `fail()` corre
   * despues, en `JobQueueService.manejarFallo`. Si no se excluyera, ese job se contaria dos veces
   * (cuando arrastra el marcador de un intento anterior) o cero (cuando es su primer fallo), y el
   * umbral efectivo bailaria entre 2 y 4 segun el intento. El servicio compara `otros + 1`.
   *
   * «No completados» = `pending`, `processing` o `failed`. Un job `done` con marcador es la
   * fotografia de un intento anterior YA SUPERADO: contarlo seria contar un corte que termino.
   */
  contarFallosConfigDesde(desde: Date, excluirJobId: string): Promise<number>;

  /**
   * R13/R15/R16/R19/R21/R22/R23/R24 — devuelve a `pending` hasta `limite` jobs de geocodificacion
   * en `failed` cuyo `last_error` lleva el marcador, **los mas ANTIGUOS primero** (`updated_at`
   * ASC), sin tocar los modificados despues de `tocadoAntesDe`.
   *
   * Los deja en condiciones de volver a ejecutarse: `intentos = 0`, `last_error = NULL`,
   * `locked_at = NULL`, y `run_after` ESCALONADO desde `ahora` cada `espaciadoMs`. NO cambia
   * `tipo`, `payload` ni `dedupe_key` (R15).
   *
   * Devuelve cuantos revivio.
   */
  revivirFallosConfig(opts: RevivirFallosConfigOpts): Promise<number>;
}
