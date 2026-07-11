-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso
-- (R10/R11). NO toca la tabla "orden" ni ninguna otra migracion previa. Como la
-- eliminacion de provincia.zona_id quedo DIFERIDA (blocker R4), el down tampoco la
-- restaura: provincia.zona_id nunca se toco en el UP.

-- usuario: elimina zona_id + FK + indice.
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";
DROP INDEX IF EXISTS "usuario_zona_id_idx";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "zona_id";

-- distrito: elimina zona_id + FK + indice.
ALTER TABLE "distrito" DROP CONSTRAINT IF EXISTS "distrito_zona_id_fkey";
DROP INDEX IF EXISTS "distrito_zona_id_idx";
ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_id";

-- provincia: restaura el NOT NULL de zona_id (relajado en el UP). Requiere que no
-- haya filas con zona_id NULL; la geografia esta vacia en este repo.
ALTER TABLE "provincia" ALTER COLUMN "zona_id" SET NOT NULL;

-- zona: elimina indices y columnas nuevas (orden inverso a la creacion).
DROP INDEX IF EXISTS "zona_es_gam_unico";
DROP INDEX IF EXISTS "zona_nombre_key";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "es_gam";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_rechazo";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_entrega";
