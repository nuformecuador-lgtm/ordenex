-- DOWN de la ficha 474 (T1.1): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se
-- RECREA sin los cinco valores de esta ficha. Criterio IDENTICO al de
-- `20260923120000_job_tipo_webhook_evento/down.sql`, replicado sin variar (incluido el paso del
-- indice parcial de la 401).
--
-- Precondicion: ninguna fila de "jobs" con uno de esos tipos. Se borran aqui, ANTES del ALTER: son
-- jobs de una ficha que se esta revirtiendo. LO QUE SE PIERDE, DECLARADO: las ocurrencias programadas
-- pendientes, los avisos puenteados sin ejecutar, los reintentos de entregas y el mantenimiento
-- diario. Las tablas `whatsapp_envio*` las borra el down de `20261005120100_whatsapp_envios`, que
-- se revierte ANTES que este.
DELETE FROM "jobs" WHERE "tipo" IN (
  'whatsapp_envio_programado',
  'whatsapp_envio_evento',
  'whatsapp_envio_ejecucion',
  'whatsapp_envio_reintento',
  'whatsapp_envio_mantenimiento'
);

-- ⚠️ LA LISTA ES UNA FOTO DE ESTA RAMA. Recrear el tipo con una lista BORRA EN SILENCIO cualquier
-- valor que otra ficha haya anadido DESPUES de esta. La lista se leyo de `db/schema.prisma` en
-- `origin/dev` @ 9a9e37a8 (2026-10-05) y son los ONCE valores que el enum tenia ANTES de esta
-- migracion:
--   liberar_reprogramadas        (feature 90,  20260717120000_jobs_cola)
--   geocodificacion              (feature 91,  20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta            (feature 92,  20260720120000_job_tipo_optimizacion_ruta)
--   webhook_estado               (feature 99,  20260721120000_job_tipo_webhook_estado)
--   whatsapp_template_sync       (WhatsApp,    20260723120000_job_tipo_whatsapp_template_sync)
--   whatsapp_chat_envio          (feature 109, 20260723140100_job_tipo_whatsapp_chat_envio)
--   analitica_rollup_diario      (feature 124, 20260801100000_job_tipo_analitica_rollup_diario)
--   analitica_invalidacion_cache (feature 128, 20260803140000_job_tipo_analitica_invalidacion_cache)
--   whatsapp_bienvenida          (bienvenida,  20260827100000_job_tipo_whatsapp_bienvenida)
--   push_web                     (ficha 410,   20260912120100_job_tipo_push_web)
--   webhook_evento               (ficha 454,   20260923120000_job_tipo_webhook_evento)
-- Si al revertir la base ya tuviera un valor de una ficha posterior, HAY QUE ANADIRLO A ESTA
-- LISTA antes de ejecutar. El ORDEN importa.
--
-- ROLLBACK ENCADENADO (memoria del repo: los `down.sql` previos NO se tocan, son fotos historicas):
-- si despues de este down se revierte tambien la 454, su propio down recrea el tipo con diez
-- valores; como este ya quito los de la 474, esa lista sigue siendo correcta.

-- El indice PARCIAL de la 401 (`WHERE "tipo" = 'geocodificacion'`) rompe el `USING` en cuanto el
-- tipo se renombra (`operator does not exist: job_tipo = job_tipo_old`, medido el 2026-09-10): se
-- suelta antes y se recrea despues, identico a su migracion (20260910110000).
DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx";

ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario', 'analitica_invalidacion_cache', 'whatsapp_bienvenida', 'push_web', 'webhook_evento');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";

CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"
  ON "jobs" ("estado", "updated_at")
  WHERE "tipo" = 'geocodificacion';
