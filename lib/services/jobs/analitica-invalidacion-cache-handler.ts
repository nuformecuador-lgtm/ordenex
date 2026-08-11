// Feature 128 (T6.3, R14) — HANDLER del job puntual `analitica_invalidacion_cache`.
//
// Es el otro extremo del enganche del backfill: `revalidateTag` LANZA fuera de un request de
// Next (`revalidate.js:104-107`) y el backfill de la 125 es un proceso `tsx`, asi que el
// script ENCOLA y este handler —que corre dentro del request del cron, cada minuto— invalida.
//
// ⚠ ESTE TIPO **NO SE REGISTRA EN `buildRecurrencias`**. Es PUNTUAL, disparado por un evento
// (una corrida de backfill que escribio), como `geocodificacion` o `webhook_estado`.
// Registrarlo en las recurrencias lo re-agendaria para siempre y vaciaria la cache operativa
// cada minuto, que es exactamente lo contrario de lo que esta feature compra.
//
// La granularidad sigue siendo POR DOMINIO (D3 de la 128, D1 de la 179): un unico tag por
// dominio, nunca por fecha. El payload nunca ha dicho QUE entradas invalidar y sigue sin
// decirlo — lo que dice desde la feature 179 es QUE DOMINIO.
//
// Sin `try/catch`, por el mismo motivo que el del rollup diario: si la invalidacion falla, el
// job tiene que fallar para que `JobQueueService` lo reintente con backoff. Una invalidacion
// que se traga su error deja la cifra recomputada invisible hasta que expire el TTL, y sin
// senal de que eso ocurrio.
//
// ⚠ AQUI R11 DE LA 128 SIGUE APLICANDO TAL CUAL, y conviene decirlo porque la feature 179 se
// desvia de el (D4): alli el llamador es una Server Action de cara a un maestro sobre dinero ya
// confirmado, donde fallar solo miente sobre lo que ocurrio. **Aqui el llamador vuelve a ser un
// JOB idempotente con backoff y dead-letter**, y ahi fallar es exactamente lo correcto: el
// reintento es gratis y no lo ve nadie. Por eso este camino NO pasa por
// `invalidarAnaliticaFinanciera`, que no propaga. Las dos reglas conviven porque la diferencia
// esta escrita — en `requirements.md` R16 de la 179 y aqui.
//
// ─── FEATURE 179 (T3.8, D2 — R27): EL DOMINIO SALE DEL PAYLOAD ──────────────────────────────
// El backfill de tesoreria (`scripts/backfill-caja-tesoreria.ts`) es el unico escritor de ledger
// que corre FUERA de un request, asi que encola en vez de invalidar. Reusa ESTE tipo de job con
// `{ dominio: "financiera" }` en el payload (D2 = (a), sin migracion: el valor del enum ya
// existe). El default `operativa` es COMPATIBILIDAD MEDIDA, no cortesia: los jobs de la 128 no
// llevan `dominio` y sin el dejarian de invalidar en silencio (ver `dominioDelPayload`).

import { TAGS_FINANCIERA, TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import {
  dominioDelPayload,
  type DominioInvalidacion,
} from "@/lib/services/jobs/analitica-invalidacion-encolado";

/** Los tags de cada dominio. Salen de `cache-tags.ts`, la UNICA lista (R6). */
const TAGS_POR_DOMINIO: Readonly<Record<DominioInvalidacion, readonly string[]>> = {
  operativa: TAGS_OPERATIVA,
  financiera: TAGS_FINANCIERA,
};

/**
 * El origen registrado por dominio (R24). `operativa` conserva `backfill` —el valor que la 128
 * escribe y que su test comprueba—, y la financiera estrena el suyo para que el registro pueda
 * decir CUAL invalidador no llego, que es lo unico para lo que existe.
 */
const ORIGEN_POR_DOMINIO: Readonly<Record<DominioInvalidacion, OrigenInvalidacion>> = {
  operativa: "backfill",
  financiera: "job_backfill_tesoreria",
};

export function crearAnaliticaInvalidacionCacheHandler(cache: IAnaliticaCache): JobHandler {
  return async (job) => {
    const dominio = dominioDelPayload(job.payload);
    await cache.invalidar(ORIGEN_POR_DOMINIO[dominio], TAGS_POR_DOMINIO[dominio]);
  };
}
