-- DOWN de M1 (ficha 454): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA
-- sin 'webhook_evento'. Criterio IDENTICO al de `20260912120100_job_tipo_push_web/down.sql`,
-- replicado sin variar (incluido el paso del indice parcial de la 401).
--
-- Precondicion: ninguna fila de "jobs" con tipo = 'webhook_evento'. Se borran aqui, ANTES del ALTER:
-- son jobs de una ficha que se esta revirtiendo. LO QUE SE PIERDE, DECLARADO: un job pendiente
-- borrado es un webhook de evento que no se entrega; el HECHO sigue en `orden_evento` hasta que el
-- down de M2 borre la tabla (ver alli su perdida declarada).
DELETE FROM "jobs" WHERE "tipo" = 'webhook_evento';

-- ⚠️ LA LISTA ES UNA FOTO DE ESTA RAMA. Recrear el tipo con una lista BORRA EN SILENCIO cualquier
-- valor que otra ficha haya anadido DESPUES de esta. La lista se leyo de `db/schema.prisma` en
-- `origin/dev` @ 63d846a3 y son los DIEZ valores que el enum tenia ANTES de esta migracion:
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
-- Si al revertir la base ya tuviera un 12.º valor de una ficha posterior, HAY QUE ANADIRLO A ESTA
-- LISTA antes de ejecutar. El ORDEN importa.
--
-- ROLLBACK ENCADENADO (memoria del repo: los `down.sql` previos NO se tocan, son fotos historicas):
-- si despues de este down se revierte tambien la 410, su propio down recrea el tipo con nueve
-- valores; como este ya quito `webhook_evento`, esa lista sigue siendo correcta.

-- El indice PARCIAL de la 401 (`WHERE "tipo" = 'geocodificacion'`) rompe el `USING` en cuanto el
-- tipo se renombra (`operator does not exist: job_tipo = job_tipo_old`, medido el 2026-09-10): se
-- suelta antes y se recrea despues, identico a su migracion (20260910110000).
DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx";

ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario', 'analitica_invalidacion_cache', 'whatsapp_bienvenida', 'push_web');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";

CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"
  ON "jobs" ("estado", "updated_at")
  WHERE "tipo" = 'geocodificacion';
