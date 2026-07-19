-- DOWN (R5): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA
-- sin 'geocodificacion'. Patron identico al de 20260716140000_rol_api_key/down.sql y
-- 20260710130000_rol_admin_satelite/down.sql.
--
-- Precondicion del rollback: ninguna fila de "jobs" con tipo = 'geocodificacion'. Si
-- quedara alguna, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor no existe en el
-- tipo nuevo) y el rollback aborta. Se borran explicitamente aqui, ANTES del ALTER: son
-- jobs de una feature que se esta revirtiendo, no hay nada que conservar.
DELETE FROM "jobs" WHERE "tipo" = 'geocodificacion';

-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   liberar_reprogramadas   (feature 90, 20260717120000_jobs_cola)
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
