-- DOWN (R21): revierte exactamente migration.sql. DROP TABLE arrastra el indice unico
-- `premio_ranking_posicion_key`, el CHECK de posicion, las 3 filas seed y la configuracion
-- de RLS. No hay enum propio ni FK.
DROP TABLE IF EXISTS "premio_ranking";
