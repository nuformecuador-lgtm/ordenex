-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca el enum "cierre_estado" (es de la feature 37) ni la RLS/columnas
-- preexistentes de cierre_dia/zona/usuario fuera de lo agregado por el UP.

-- 2) FK nullable cierre_bodega_id en cierre_dia: soltar indice y FK antes de la columna.
DROP INDEX IF EXISTS "cierre_dia_cierre_bodega_id_idx";
ALTER TABLE "cierre_dia" DROP CONSTRAINT IF EXISTS "cierre_dia_cierre_bodega_id_fkey";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "cierre_bodega_id";

-- 1) tabla cierre_bodega (DROP TABLE arrastra sus FKs e indices, incl. el unico parcial).
DROP TABLE IF EXISTS "cierre_bodega";
-- El enum "cierre_estado" NO se toca (es de la feature 37).
