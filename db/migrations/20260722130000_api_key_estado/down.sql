-- DOWN: revierte exactamente migration.sql. Primero la columna (que depende del tipo),
-- luego el tipo. Sin `DROP VALUE` (Postgres no lo soporta): el enum se elimina entero
-- porque lo creo esta misma migracion y ninguna tabla mas lo referencia.
ALTER TABLE "api_key" DROP COLUMN IF EXISTS "estado";

DROP TYPE IF EXISTS "estado_api_key";
