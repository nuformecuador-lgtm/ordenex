-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- No toca RLS/columnas preexistentes fuera de lo agregado por el UP.

-- 3) columna cobra_comision de orden (R26).
ALTER TABLE "orden" DROP COLUMN IF EXISTS "cobra_comision";

-- 2) tabla wallet_movimiento (DROP TABLE arrastra su FK e indices, incl. el unico parcial).
DROP TABLE IF EXISTS "wallet_movimiento";

-- 1) enums nativos (en orden inverso a su creacion).
DROP TYPE IF EXISTS "wallet_origen_tipo";
DROP TYPE IF EXISTS "wallet_movimiento_categoria";
DROP TYPE IF EXISTS "wallet_movimiento_tipo";
