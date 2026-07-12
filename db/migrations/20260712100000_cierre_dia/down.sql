-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca tablas ni columnas preexistentes fuera de lo agregado por el UP.

-- 3) FK nullable cierre_id en gestion_orden: soltar FK e indice antes de la columna.
ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_cierre_id_fkey";
DROP INDEX IF EXISTS "gestion_orden_cierre_id_idx";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "cierre_id";

-- 2) tabla cierre_dia (DROP TABLE arrastra sus FKs e indices).
DROP TABLE IF EXISTS "cierre_dia";

-- 1) enums (ya sin tabla que los use).
DROP TYPE IF EXISTS "cierre_destino_tipo";
DROP TYPE IF EXISTS "cierre_estado";
