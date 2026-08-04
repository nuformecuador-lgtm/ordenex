-- DOWN: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- 'analitica_invalidacion_cache'. Criterio IDENTICO al de
-- 20260801100000_job_tipo_analitica_rollup_diario/down.sql (feature 124), replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'analitica_invalidacion_cache'.
-- Si quedara alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el
-- tipo nuevo) y el rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son jobs
-- de una feature que se esta revirtiendo y no hay nada que conservar. Borrar la fila de la
-- cola NO pierde datos: un job de invalidacion de cache es idempotente y sin el la unica
-- consecuencia es que la cache expira por TTL en vez de al instante.
DELETE FROM "jobs" WHERE "tipo" = 'analitica_invalidacion_cache';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90,  20260717120000_jobs_cola)
--   geocodificacion         (feature 91,  20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta       (feature 92,  20260720120000_job_tipo_optimizacion_ruta)
--   webhook_estado          (feature 99,  20260721120000_job_tipo_webhook_estado)
--   whatsapp_template_sync  (WhatsApp,    20260723120000_job_tipo_whatsapp_template_sync)
--   whatsapp_chat_envio     (feature 109, 20260723140100_job_tipo_whatsapp_chat_envio)
--   analitica_rollup_diario (feature 124, 20260801100000_job_tipo_analitica_rollup_diario)
-- El ORDEN importa: recrear el tipo con otro orden cambiaria el orden de comparacion del enum.
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
