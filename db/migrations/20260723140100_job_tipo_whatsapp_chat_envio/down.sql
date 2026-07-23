-- DOWN: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- 'whatsapp_chat_envio'. Criterio IDENTICO al de
-- 20260721120000_job_tipo_webhook_estado/down.sql, replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'whatsapp_chat_envio'. Se
-- borran explicitamente aqui, ANTES del ALTER: son jobs de una feature que se revierte.
DELETE FROM "jobs" WHERE "tipo" = 'whatsapp_chat_envio';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90)
--   geocodificacion         (feature 91)
--   optimizacion_ruta       (feature 92)
--   webhook_estado          (feature 99)
--   whatsapp_template_sync  (integracion WhatsApp 107)
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
