-- DOWN de la feature 144: revierte EXACTAMENTE los cuatro indices del UP, en orden
-- inverso. `IF EXISTS` para que el rollback sea idempotente.
DROP INDEX IF EXISTS "orden_distrito_id_idx";
DROP INDEX IF EXISTS "orden_canton_id_idx";
DROP INDEX IF EXISTS "orden_provincia_id_idx";
DROP INDEX IF EXISTS "orden_zona_id_idx";
