-- Revierte EXACTAMENTE `migration.sql`: deshace el RENAME, sin tocar tipo, NOT NULL ni DEFAULT.
--
-- `RENAME COLUMN` preserva los valores fila por fila en los DOS sentidos, asi que este down no
-- pierde ni un dato: la columna vuelve a llamarse `pre_aprobacion` con exactamente el mismo
-- contenido. Despues de esto, `20260818130000_orden_pre_aprobacion/down.sql` encuentra el nombre
-- que espera.
ALTER TABLE "orden" RENAME COLUMN "gestion_aprobada" TO "pre_aprobacion";
