// Feature 124 (D4->C1, design §8, R36/R37/R38) — handler DELGADO del job recurrente
// `analitica_rollup_diario` + su `RecurrenciaSpec`. Patron calcado de
// `liberar-reprogramadas-handler.ts` (feature 90).
//
// El handler NO agrega nada por su cuenta: deriva la fecha objetivo del reloj INYECTADO y
// delega TODO en `AnaliticaRollupService.agregarFecha(fecha)`, que es idempotente (R27) y
// todo-o-nada (R30), asi que un re-claim por visibility timeout o un reintento con backoff
// son seguros.
//
// Este modulo NO nombra la tabla del rollup ni la consulta de ninguna forma: la unica puerta a
// esa tabla es `lib/repositories/AnaliticaRollupRepository.ts` (guardia de frontera, R42).
import type { IAnaliticaRollupService } from "@/lib/interfaces/services/IAnaliticaRollupService";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import { AnaliticaRollupService } from "@/lib/services/AnaliticaRollupService";
import { AnaliticaRollupRepository } from "@/lib/repositories/AnaliticaRollupRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { fechaObjetivo } from "@/lib/analytics/rollup-dia";
import { dedupeKeyRollup } from "@/lib/services/jobs/analitica-rollup-diario-encolado";
// Feature 128 (R10/R11): la invalidacion de la cache de analitica cuelga de aqui. Entra por
// PUERTO (`IAnaliticaCache`), no por `next/cache`: este modulo lo importan tests unitarios que
// corren sin runtime de Next, donde `revalidateTag` lanza (R21).
import { cacheNula } from "@/lib/cache/cache-nula";
import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";

// CR es UTC-6 fijo (sin horario de verano): 00:30 CR == 06:30 UTC.
const CR_OFFSET_MS = 6 * 60 * 60 * 1000;
const CORRIDA_HORA_UTC = 6;
const CORRIDA_MINUTO_UTC = 30;

/**
 * D3 — proxima corrida = **00:30 America/Costa_Rica del dia siguiente** (06:30 UTC),
 * ESTRICTAMENTE posterior a `now`.
 *
 * Por que 00:30 y no 00:00: `vercel.json` arranca `corte-diario` y `generar-gastos-fijos` a
 * las `0 6 * * *` (00:00 CR). Media hora de margen contra el ARRANQUE del corte —no contra su
 * final, que nadie ha medido—. Bajo D1->A2 ese margen ya no decide el `estatus_id` (las
 * transiciones `corte_sin_gestionar` caen en el corte exacto y la cota estricta las deja
 * fuera), pero si la deriva de las tres coordenadas que NO se congelan: cuanto antes corra,
 * menos deriva acumulan.
 *
 * `now` cae siempre dentro del dia CR que arranca a las `D 06:00 UTC`, asi que `D+1 06:30
 * UTC` es SIEMPRE posterior: no hace falta un bucle de avance.
 */
export function proximaCorridaRollupCR(now: Date): Date {
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  return new Date(
    Date.UTC(
      crWall.getUTCFullYear(),
      crWall.getUTCMonth(),
      crWall.getUTCDate() + 1,
      CORRIDA_HORA_UTC,
      CORRIDA_MINUTO_UTC,
      0,
      0,
    ),
  );
}

/**
 * R36 — registro de recurrencia. El `dedupeKey` lleva la fecha que ESA corrida agregara
 * (D-1 respecto de la corrida), no la fecha de la corrida: ver
 * `analitica-rollup-diario-encolado.ts`.
 */
export const recurrenciaAnaliticaRollupDiario: RecurrenciaSpec = {
  siguiente(now: Date) {
    const runAfter = proximaCorridaRollupCR(now);
    return { runAfter, dedupeKey: dedupeKeyRollup(fechaObjetivo(runAfter)) };
  },
};

/** Sumidero del resumen de la corrida, inyectable para test. NUNCA registra PII (R37). */
export interface RollupJobLogger {
  info(mensaje: string): void;
}

const defaultLogger: RollupJobLogger = { info: (m) => console.log(m) };

/**
 * R22/R37/R38 — handler delgado.
 *
 * - Deriva la fecha objetivo con `fechaObjetivo(now())` (D3: el dia que acaba de cerrar) y
 *   delega en el servicio. Ni una linea de agregacion vive aqui.
 * - Registra el resumen de la corrida con **conteos agregados y nada mas** (R37): fecha,
 *   filas escritas, filas retiradas y ms. Sin ids, sin destinatarios, sin telefonos.
 * - `JSON.stringify` del registro es DELIBERADO (R32): si alguien metiera aqui un `BigInt`
 *   —`seg_ciclo_acum` lo es en la base— la serializacion lanzaria `TypeError` y el job
 *   moriria. Que el test lo cace aqui, en un handler de dos lineas, y no en produccion.
 * - Feature 128 (R10): tras agregar, INVALIDA la cache del dominio operativa. El
 *   `invalidador` tiene default `cacheNula()` para que los tests de la 124 sigan corriendo sin
 *   tocarlos y sin arrastrar el runtime de Next. Ese default es un no-op, asi que el riesgo
 *   real —que el composition root se olvide de pasar el puerto de verdad— no lo cubre el tipo:
 *   lo cubre una asercion estatica sobre `app/api/cron/procesar-jobs/route.ts` en
 *   `tests/unit/analytics/cache-invalidacion-job.test.ts`.
 * - NO hay `try/catch` (R38): un fallo del servicio se propaga tal cual, con su fecha y su
 *   etapa dentro del `AnaliticaRollupError`, para que `JobQueueService` lo cuente como fallo,
 *   aplique el backoff y acabe en dead-letter si toca. Tragarselo dejaria el dia sin agregar
 *   y el job marcado como completado con exito.
 */
export function crearAnaliticaRollupDiarioHandler(
  service: IAnaliticaRollupService,
  now: () => Date = () => new Date(),
  logger: RollupJobLogger = defaultLogger,
  invalidador: IAnaliticaCache = cacheNula(),
): JobHandler {
  return async () => {
    const fecha = fechaObjetivo(now());
    const resumen = await service.agregarFecha(fecha);
    // Feature 128 (R10/R11) — la invalidacion va DESPUES de que `agregarFecha` resuelva y
    // SIN `try/catch`. Si el agregado fallo no hay nada que invalidar; y si la invalidacion
    // falla, el job NO puede reportar exito: el error sube para que `JobQueueService` lo
    // cuente como fallo y aplique su backoff. Una invalidacion que falla en silencio deja la
    // cifra congelada para siempre y sin senal — el modo de fallo mas caro de esta feature.
    await invalidador.invalidar("job_rollup_diario", TAGS_OPERATIVA);
    const registro = {
      job: "analitica_rollup_diario",
      fecha: resumen.fecha,
      filasEscritas: resumen.filasEscritas,
      filasRetiradas: resumen.filasRetiradas,
      ms: resumen.ms,
    };
    logger.info(`[analitica_rollup_diario] ${JSON.stringify(registro)}`);
  };
}

/**
 * Construye el servicio real con sus repos (patron de `buildLiberarReprogramadasService`).
 * `getPrismaClient()` es un singleton perezoso: llamarlo aqui NO abre conexion, que es lo que
 * permite que `buildHandlers` se construya en un test sin base.
 */
export function buildAnaliticaRollupService(now: () => Date): IAnaliticaRollupService {
  const prisma = getPrismaClient();
  return new AnaliticaRollupService(
    new AnaliticaRollupRepository(prisma),
    new OrdenHistorialService(new OrdenRepository(prisma), new OrdenHistorialRepository(prisma)),
    { now },
  );
}
