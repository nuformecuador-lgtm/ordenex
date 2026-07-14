-- DOWN (R33): revierte exactamente migration.sql. DROP TABLE arrastra el indice
-- `gasto_fijo_plantilla_activa_idx` y la configuracion de RLS. No hay enum propio ni FK.
DROP TABLE IF EXISTS "gasto_fijo_plantilla";
