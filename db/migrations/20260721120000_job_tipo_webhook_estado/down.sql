-- DOWN (R4): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA
-- sin 'webhook_estado'. Criterio IDENTICO al de
-- 20260720120000_job_tipo_optimizacion_ruta/down.sql (feature 92), replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'webhook_estado'. Si quedara
-- alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el tipo
-- nuevo) y el rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son jobs de
-- una feature que se esta revirtiendo, no hay nada que conservar.
DELETE FROM "jobs" WHERE "tipo" = 'webhook_estado';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90, 20260717120000_jobs_cola)
--   geocodificacion         (feature 91, 20260719120000_job_tipo_geocodificacion)
--   optimizacion_ruta       (feature 92, 20260720120000_job_tipo_optimizacion_ruta)
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
