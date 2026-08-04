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
// El handler NO mira el payload para decidir QUE invalidar: la granularidad es POR DOMINIO
// (D3), un unico tag. El payload (`{ desde, hasta }`) existe solo para el registro de R23.
//
// Sin `try/catch`, por el mismo motivo que el del rollup diario: si la invalidacion falla, el
// job tiene que fallar para que `JobQueueService` lo reintente con backoff. Una invalidacion
// que se traga su error deja la cifra recomputada invisible hasta que expire el TTL, y sin
// senal de que eso ocurrio.

import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";

export function crearAnaliticaInvalidacionCacheHandler(cache: IAnaliticaCache): JobHandler {
  return async () => {
    await cache.invalidar("backfill", TAGS_OPERATIVA);
  };
}
