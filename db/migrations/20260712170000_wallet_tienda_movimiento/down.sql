-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- No toca RLS/columnas preexistentes ni el enum wallet_origen_tipo (reutilizado de la 42).

-- 2) tabla wallet_tienda_movimiento (DROP TABLE arrastra sus FKs e indices, incl. el
--    unico parcial de idempotencia).
DROP TABLE IF EXISTS "wallet_tienda_movimiento";

-- 1) enums nativos propios de la 43 (en orden inverso a su creacion). El enum de origen
--    (wallet_origen_tipo) NO se toca: es de la 42.
DROP TYPE IF EXISTS "wallet_tienda_movimiento_categoria";
DROP TYPE IF EXISTS "wallet_tienda_movimiento_tipo";
