-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso
-- (R10/R11). NO toca la tabla "orden" ni ninguna otra migracion previa. El UP
-- ELIMINA provincia.zona_id (R4), asi que este down SI la restaura (columna +
-- indice + FK), asumiendo geografia vacia (ver bloque de provincia mas abajo).

-- usuario: elimina zona_id + FK + indice.
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";
DROP INDEX IF EXISTS "usuario_zona_id_idx";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "zona_id";

-- distrito: elimina zona_id + FK + indice.
ALTER TABLE "distrito" DROP CONSTRAINT IF EXISTS "distrito_zona_id_fkey";
DROP INDEX IF EXISTS "distrito_zona_id_idx";
ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_id";

-- provincia: restaura zona_id (columna + indice + FK) tal como existia antes de la
-- feature 24. ASUME geografia VACIA (sin filas): re-crea la columna como NOT NULL sin
-- default, lo cual solo es valido si "provincia" no tiene filas. En este repo la
-- geografia esta vacia (feature 6 la creo vacia).
ALTER TABLE "provincia" ADD COLUMN "zona_id" TEXT NOT NULL;
CREATE INDEX "provincia_zona_id_idx" ON "provincia"("zona_id");
ALTER TABLE "provincia" ADD CONSTRAINT "provincia_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- zona: elimina indices y columnas nuevas (orden inverso a la creacion).
DROP INDEX IF EXISTS "zona_es_gam_unico";
DROP INDEX IF EXISTS "zona_nombre_key";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "es_gam";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_rechazo";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_entrega";
