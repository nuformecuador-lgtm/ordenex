-- DOWN: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- 'whatsapp_template_sync'. Criterio IDENTICO al de
-- 20260721120000_job_tipo_webhook_estado/down.sql, replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'whatsapp_template_sync'. Si
-- quedara alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el tipo
-- nuevo) y el rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son jobs de una
-- feature que se esta revirtiendo, no hay nada que conservar.
DELETE FROM "jobs" WHERE "tipo" = 'whatsapp_template_sync';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90, 20260717120000_jobs_cola)
--   geocodificacion         (feature 91, 20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta       (feature 92, 20260720120000_job_tipo_optimizacion_ruta)
--   webhook_estado          (feature 99, 20260721120000_job_tipo_webhook_estado)
-- `whatsapp_chat_envio` NO va en la lista: lo anade una migracion POSTERIOR
-- (20260723140100_job_tipo_whatsapp_chat_envio), que en un rollback ordenado ya se revirtio.
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
