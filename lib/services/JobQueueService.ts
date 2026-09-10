import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  DrenarResult,
  IJobQueueService,
  JobHandler,
  RecurrenciaSpec,
} from "@/lib/interfaces/services/IJobQueueService";
import type { JobsConfig } from "@/lib/config/jobs";
import type { JobTipo } from "@prisma/client";

// Log de aviso inyectable (patron `LiberacionLogger`): por defecto console.warn. NUNCA
// registra PII ni secretos (R18/R19): solo mensajes agregados sin datos de dominio.
export interface JobsLogger {
  warn(message: string): void;
  /**
   * Feature 402 (R8) — canal informativo del desglose por tipo de cada corrida. OPCIONAL a
   * proposito: al menos diez archivos de test instancian este servicio con un doble que solo
   * implementa `warn`, y exigir `info` romperia el typecheck de todos ellos sin que ninguno
   * tenga que ver con esta ficha. Se invoca con `this.logger.info?.(...)`.
   */
  info?(message: string): void;
}
const defaultLogger: JobsLogger = { warn: (m) => console.warn(m), info: (m) => console.info(m) };

// `last_error` acotado (R15): sin volcar stacks enormes. El mensaje del handler no
// contiene el secreto (el secreto vive en el controller, no llega al service).
const MAX_ERROR_LEN = 500;
function mensajeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, MAX_ERROR_LEN);
}

/**
 * FICHA 403 (design §6) — un error que ADEMAS sugiere cuanto esperar antes del proximo intento.
 *
 * DUCK-TYPED Y AGNOSTICO DEL TIPO DE JOB a proposito: este service lo comparten nueve tipos y no
 * debe saber que existe un webhook, ni un 429, ni una "suscripcion pausada". Solo sabe leer «este
 * error trae una sugerencia de espera». Hoy la rellenan dos cosas distintas —el `Retry-After` de
 * un 429 real y el intervalo de pausa del circuito de la 403— y la cola no distingue entre ellas
 * ni necesita hacerlo. Meter aqui el circuit breaker entero seria acoplar un componente compartido
 * a un concepto que solo existe para UN tipo de job (design §8, alternativa descartada 4).
 */
interface JobRetryHint {
  retryAfterMs?: number;
}

/**
 * La sugerencia del error, si trae una USABLE. `undefined` en cualquier otro caso: sin campo, con
 * un valor que no es un numero finito, o con un numero <= 0 (pedir "espera 0" o menos es pedir
 * reintentar YA, mas agresivo que el backoff normal, que es lo contrario de lo que un destino
 * saturado esta pidiendo).
 */
function retryAfterHintMs(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const hint = (err as JobRetryHint).retryAfterMs;
  if (typeof hint !== "number" || !Number.isFinite(hint) || hint <= 0) return undefined;
  return hint;
}

/**
 * Feature 90 (design §4) — servicio drenador de la cola. DI por INTERFACES (no `prisma`),
 * `now` inyectable y logger con default (patron `LiberacionReprogramadaService`). `drenar`
 * reclama un lote, ejecuta el handler por tipo y aplica complete / backoff exponencial
 * acotado / dead-letter, re-agendando las ocurrencias recurrentes en exito Y en fallo
 * terminal (R23/R24). La recurrencia por tipo vive en un registro (`recurrencias`),
 * evitando `if` por nombre disperso.
 */
export class JobQueueService implements IJobQueueService {
  constructor(
    private readonly repo: IJobRepository,
    private readonly handlers: Map<JobTipo, JobHandler>,
    private readonly recurrencias: Map<JobTipo, RecurrenciaSpec>,
    private readonly config: JobsConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: JobsLogger = defaultLogger,
  ) {}

  async drenar(limit: number): Promise<DrenarResult> {
    const now = this.now();
    // R13: `processing` con `locked_at` mas antiguo que el visibility timeout se rescata.
    const visibilityCutoff = new Date(now.getTime() - this.config.JOBS_VISIBILITY_TIMEOUT_MS);
    // R10: reclamo atomico del lote (SKIP LOCKED). `intentos` ya viene incrementado.
    const jobs = await this.repo.claimBatch(limit, { now, visibilityCutoff });

    // Feature 402 (R8): que tipos avanzaron en ESTA corrida. Se calcula agrupando el array
    // que el claim ya devolvio —ni una consulta mas (R7)— y solo lleva `tipo` (un valor de
    // enum) y un conteo: nada de `payload`, ids ni datos de dominio (R18/R19 de la 90). Sin
    // esto, ver que un tipo lleva media hora sin correr exige consultar `jobs` a mano, que es
    // lo que hubo que hacer en el incidente del 2026-09-09.
    if (jobs.length > 0) {
      const porTipo = jobs.reduce<Record<string, number>>((acc, j) => {
        acc[j.tipo] = (acc[j.tipo] ?? 0) + 1;
        return acc;
      }, {});
      this.logger.info?.(`[procesar-jobs] reclamados por tipo: ${JSON.stringify(porTipo)}`);
    }

    const result: DrenarResult = {
      procesados: jobs.length,
      ok: 0,
      fallidos: 0,
      reintentados: 0,
      muertos: 0,
    };

    for (const job of jobs) {
      const handler = this.handlers.get(job.tipo);
      if (handler === undefined) {
        // Registro incompleto (config/despliegue): fallo CONTROLADO, no crash de la corrida.
        result.fallidos += 1;
        await this.manejarFallo(job, "handler no registrado para el tipo de job", now, result);
        continue;
      }
      try {
        await handler(job);
        await this.repo.complete(job.id); // R14
        result.ok += 1;
        await this.reagendarRecurrente(job, now); // R23: recurrencia tras exito
      } catch (err) {
        // R14 (fallo): un fallo por job no aborta la corrida; se contabiliza y se continua.
        // FICHA 403: del `err` ya no sale solo el texto — tambien la sugerencia de espera, si la
        // trae. Es el UNICO punto donde el error del handler llega entero; hasta hoy se convertia
        // a texto y se tiraba.
        result.fallidos += 1;
        await this.manejarFallo(job, mensajeError(err), now, result, retryAfterHintMs(err));
      }
    }

    if (result.fallidos > 0) {
      this.logger.warn(`[procesar-jobs] ${result.fallidos} job(s) fallido(s) en esta corrida`);
    }
    return result;
  }

  /**
   * R15/R16: decide backoff vs dead-letter usando `max_intentos` POR-FILA (fuente de verdad,
   * gate F1.4-2). `intentos` ya fue incrementado por el claim, asi que refleja el numero de
   * este intento. Terminal -> `failed` (R16) y, si el tipo es recurrente, re-agenda la
   * proxima ocurrencia (R24: un fallo puntual NO detiene el job diario para siempre).
   *
   * FICHA 403 (R14/R16/R17): `hintMs` es una SUGERENCIA de espera que trae el error (el
   * `Retry-After` de un 429, o el intervalo de pausa del circuito de webhooks). No cambia NADA del
   * conteo de intentos ni de la decision de dead-letter: un 429 —o una racha en pausa— sigue
   * gastando su intento y sigue muriendo al agotarlos (R16). Lo unico que puede mover es el
   * `runAfter` de un reintento que igualmente iba a ocurrir.
   */
  private async manejarFallo(
    job: JobDTO,
    mensaje: string,
    now: Date,
    result: DrenarResult,
    hintMs?: number,
  ): Promise<void> {
    if (job.intentos >= job.maxIntentos) {
      // R16: TERMINAL. La sugerencia se ignora a proposito — no hay proximo intento que retrasar,
      // y `runAfter` de un dead-letter es `null` por contrato.
      await this.repo.fail(job.id, mensaje, null); // dead-letter
      result.muertos += 1;
      await this.reagendarRecurrente(job, now); // R24
      return;
    }
    // R15: backoff exponencial acotado por el cap. intentos=1 -> base; 2 -> base*2; ...
    const backoff = Math.min(
      this.config.JOBS_BACKOFF_CAP_MS,
      this.config.JOBS_BACKOFF_BASE_MS * 2 ** (job.intentos - 1),
    );
    // FICHA 403 — LA SUGERENCIA SE ACOTA POR LOS DOS LADOS, y cada cota tiene su motivo:
    //   · `Math.min(hint, CAP)` (R17): un `Retry-After: 999999999` de un destino hostil o
    //     malformado, o una racha de pausa muy larga, no pueden dejar un job parado
    //     indefinidamente. El tope es el que YA gobierna cualquier backoff de esta cola.
    //   · `Math.max(backoff, ...)` (R14, "nunca menor"): la sugerencia solo puede RETRASAR. Si el
    //     destino pide menos de lo que el backoff ya imponia, se queda el backoff — si no, un
    //     `Retry-After: 1` convertiria un 429 en un martilleo mas agresivo que el de hoy.
    // Sin sugerencia (el caso de siempre y el de los otros ocho tipos de job) el resultado es
    // EXACTAMENTE el de antes de esta ficha.
    const espera =
      hintMs === undefined
        ? backoff
        : Math.max(backoff, Math.min(hintMs, this.config.JOBS_BACKOFF_CAP_MS));
    const runAfter = new Date(now.getTime() + espera);
    await this.repo.fail(job.id, mensaje, runAfter);
    result.reintentados += 1;
  }

  /**
   * R23/R24/R25: re-agenda la proxima ocurrencia de un tipo recurrente. `enqueue` hace
   * `ON CONFLICT DO NOTHING`, asi que reintentos o corridas solapadas NO duplican la proxima
   * ocurrencia (idempotencia por `dedupeKey` de dia CR). Payload vacio `{}` (gate F1.4-3):
   * el handler deriva la fecha de `now` al ejecutar.
   */
  private async reagendarRecurrente(job: JobDTO, now: Date): Promise<void> {
    const spec = this.recurrencias.get(job.tipo);
    if (spec === undefined) return;
    const { runAfter, dedupeKey } = spec.siguiente(now);
    await this.repo.enqueue(job.tipo, {}, { runAfter, dedupeKey });
  }
}
