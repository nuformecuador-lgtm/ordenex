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
}
const defaultLogger: JobsLogger = { warn: (m) => console.warn(m) };

// `last_error` acotado (R15): sin volcar stacks enormes. El mensaje del handler no
// contiene el secreto (el secreto vive en el controller, no llega al service).
const MAX_ERROR_LEN = 500;
function mensajeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, MAX_ERROR_LEN);
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
        result.fallidos += 1;
        await this.manejarFallo(job, mensajeError(err), now, result);
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
   */
  private async manejarFallo(
    job: JobDTO,
    mensaje: string,
    now: Date,
    result: DrenarResult,
  ): Promise<void> {
    if (job.intentos >= job.maxIntentos) {
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
    const runAfter = new Date(now.getTime() + backoff);
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
