-- DOWN (R24): revierte EXACTAMENTE lo que `migration.sql` hace, y no pierde ni altera ningun dato
-- preexistente — porque la tabla y la columna NACEN en esta migracion.
--
-- `DROP TABLE` arrastra el UNIQUE `cierre_sin_gestion_cierre_id_orden_id_key`, el indice
-- `cierre_sin_gestion_orden_id_idx`, las 3 FKs y la configuracion de RLS. Las filas del backfill
-- (paso 6 del UP) mueren con la tabla: no hay reversa que escribir, no salieron de ningun sitio
-- que restaurar.
--
-- `DROP COLUMN "sin_gestion_registrado"` deshace el paso 5 Y el paso 7 a la vez: el UPDATE del
-- paso 7 solo escribe en esa columna, que no existia antes. No hay valor previo que devolver.
DROP TABLE IF EXISTS "cierre_sin_gestion";

ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "sin_gestion_registrado";
