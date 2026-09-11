-- DOWN: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin 'push_web'.
-- Criterio IDENTICO al de 20260827100000_job_tipo_whatsapp_bienvenida/down.sql, replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'push_web'. Si quedara alguna, el
-- `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el tipo nuevo) y el rollback
-- aborta. Se borran explicitamente aqui, ANTES del ALTER: son jobs de una feature que se esta
-- revirtiendo. LO QUE SE PIERDE, DECLARADO: un job pendiente borrado es un push que no se entrega,
-- y no hay forma de reconstruirlo -- pero el AVISO que lo origino sigue intacto en `notificacion` y
-- se sigue viendo en la campana. Al revertir esta ficha eso es justo lo que se pide: que el
-- transporte desaparezca sin tocar el hecho.
DELETE FROM "jobs" WHERE "tipo" = 'push_web';

-- ⚠️ LA LISTA ES UNA FOTO DE ESTA RAMA, y por eso hay que mirarla antes de ejecutar este archivo.
-- Recrear el tipo con una lista BORRA EN SILENCIO cualquier valor que otra ficha haya anadido
-- DESPUES de esta: el `USING` no falla, simplemente esos valores dejan de existir. La lista de
-- abajo se leyo de `db/schema.prisma` en `origin/dev` @ ca697141 y son los NUEVE valores que el
-- enum tenia ANTES de esta migracion:
--   liberar_reprogramadas        (feature 90,  20260717120000_jobs_cola)
--   geocodificacion              (feature 91,  20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta            (feature 92,  20260720120000_job_tipo_optimizacion_ruta)
--   webhook_estado               (feature 99,  20260721120000_job_tipo_webhook_estado)
--   whatsapp_template_sync       (WhatsApp,    20260723120000_job_tipo_whatsapp_template_sync)
--   whatsapp_chat_envio          (feature 109, 20260723140100_job_tipo_whatsapp_chat_envio)
--   analitica_rollup_diario      (feature 124, 20260801100000_job_tipo_analitica_rollup_diario)
--   analitica_invalidacion_cache (feature 128, 20260803140000_job_tipo_analitica_invalidacion_cache)
--   whatsapp_bienvenida          (bienvenida,  20260827100000_job_tipo_whatsapp_bienvenida)
-- Si al revertir la base ya tuviera un 11.º valor de una ficha posterior, HAY QUE ANADIRLO A ESTA
-- LISTA antes de ejecutar. El ORDEN importa: recrear el tipo con otro orden cambiaria el orden de
-- comparacion del enum.

-- ⚠️ EL PASO QUE NO ESTABA EN LAS OCHO HERMANAS, Y QUE HACE FALTA DESDE EL 2026-09-10. La ficha 401
-- creo `jobs_geocodificacion_estado_updated_idx`, un indice PARCIAL cuyo predicado es
-- `WHERE "tipo" = 'geocodificacion'`. Ese literal queda tipado como `job_tipo_old` en cuanto se
-- renombra el tipo, asi que el `ALTER TABLE ... ALTER COLUMN ... USING` de abajo --que reconstruye
-- los indices dependientes-- muere con
--     ERROR: operator does not exist: job_tipo = job_tipo_old
-- MEDIDO en la base local el 2026-09-10, no deducido: el primer intento de este rollback fallo
-- exactamente asi y Postgres revirtio el script entero. Por eso el indice se suelta ANTES y se
-- recrea DESPUES, identico a como lo escribio su propia migracion (20260910110000).
--
-- Las otras dos son inmunes y por eso no se tocan: `jobs_run_after_pending_idx` filtra por
-- `estado` (otro enum) y `jobs_dedupe_key_key` por `dedupe_key IS NOT NULL`.
--
-- Y NO se toca ningun `down.sql` anterior: son fotos de su momento y siguen siendo ciertas --el
-- rollback va de la ultima hacia atras, asi que cuando le toque el turno a
-- `20260827100000_job_tipo_whatsapp_bienvenida` el indice de la 401 ya no existira.
DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx";

ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario', 'analitica_invalidacion_cache', 'whatsapp_bienvenida');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";

-- El indice de la 401, recreado TAL CUAL lo escribio `20260910110000_jobs_geocodificacion_salud_idx`.
-- Sin esta linea el rollback dejaria las dos consultas de la salud del geocodificador en escaneo
-- secuencial sobre una tabla que solo crece, y nada fallaria: se pondria lento, en silencio.
CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"
  ON "jobs" ("estado", "updated_at")
  WHERE "tipo" = 'geocodificacion';
