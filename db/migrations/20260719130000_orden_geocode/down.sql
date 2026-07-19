-- DOWN (R5): revierte exactamente migration.sql. `DROP TABLE` arrastra la PK, el indice
-- unico `geocode_cache_direccion_hash_key` y la configuracion de RLS. Luego se quitan las
-- CINCO columnas anadidas a `orden` (ninguna tiene indice ni FK que limpiar aparte).
DROP TABLE IF EXISTS "geocode_cache";

ALTER TABLE "orden"
  DROP COLUMN IF EXISTS "latitud",
  DROP COLUMN IF EXISTS "longitud",
  DROP COLUMN IF EXISTS "geocoded_at",
  DROP COLUMN IF EXISTS "geocode_precision",
  DROP COLUMN IF EXISTS "geocode_status";
