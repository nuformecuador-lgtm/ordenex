-- DOWN (R39/R40): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se
-- RECREA sin 'optimizacion_ruta'. Criterio IDENTICO al de
-- 20260719120000_job_tipo_geocodificacion/down.sql (feature 91), replicado sin variar.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'optimizacion_ruta'. Si
-- quedara alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el
-- tipo nuevo) y el rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son
-- jobs de una feature que se esta revirtiendo, no hay nada que conservar.
DELETE FROM "jobs" WHERE "tipo" = 'optimizacion_ruta';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90, 20260717120000_jobs_cola)
--   geocodificacion         (feature 91, 20260719120000_job_tipo_geocodificacion)
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
