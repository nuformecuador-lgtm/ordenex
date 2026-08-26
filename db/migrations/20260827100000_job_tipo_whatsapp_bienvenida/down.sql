-- DOWN: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- 'whatsapp_bienvenida'. Criterio IDENTICO al de
-- 20260803140000_job_tipo_analitica_invalidacion_cache/down.sql (feature 128), replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'whatsapp_bienvenida'. Si quedara
-- alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el tipo nuevo) y el
-- rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son jobs de una feature que se
-- esta revirtiendo. LO QUE SE PIERDE, DECLARADO: un job pendiente borrado es una bienvenida que el
-- cliente no recibira, y no hay forma de reconstruirla (la marca de que se debia enviar vivia solo
-- en la cola). Al revertir esta feature eso es justo lo que se pide: que no se envie.
DELETE FROM "jobs" WHERE "tipo" = 'whatsapp_bienvenida';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas        (feature 90,  20260717120000_jobs_cola)
--   geocodificacion              (feature 91,  20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta            (feature 92,  20260720120000_job_tipo_optimizacion_ruta)
--   webhook_estado               (feature 99,  20260721120000_job_tipo_webhook_estado)
--   whatsapp_template_sync       (WhatsApp,    20260723120000_job_tipo_whatsapp_template_sync)
--   whatsapp_chat_envio          (feature 109, 20260723140100_job_tipo_whatsapp_chat_envio)
--   analitica_rollup_diario      (feature 124, 20260801100000_job_tipo_analitica_rollup_diario)
--   analitica_invalidacion_cache (feature 128, 20260803140000_job_tipo_analitica_invalidacion_cache)
-- El ORDEN importa: recrear el tipo con otro orden cambiaria el orden de comparacion del enum.
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario', 'analitica_invalidacion_cache');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
