-- Feature 141 (R13) — DOWN: revierte EXACTAMENTE lo que crea `migration.sql`.
-- Orden inverso: primero la FK/indice/columnas de `orden` (que dependen de `carga`),
-- despues la tabla `carga`. El `DROP TABLE` arrastra su PK, sus indices (incluido el
-- unico compuesto `carga_usuario_carga_name_key`), su FK a `usuario` y su RLS.
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_carga_id_fkey";
DROP INDEX IF EXISTS "orden_carga_id_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "download_url";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "carga_id";
DROP TABLE IF EXISTS "carga";
