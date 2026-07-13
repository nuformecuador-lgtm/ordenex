-- DOWN: revierte migration.sql de esta carpeta, en orden inverso.

-- Revierte tienda_id + status (FK + indice + columnas + enum).
ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_tienda_id_fkey";
DROP INDEX IF EXISTS "tarifas_tienda_id_idx";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "status";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "tienda_id";
DROP TYPE IF EXISTS "estado_tarifa";

-- Restaura nombre (feature 18) + zona_id (feature 24) tal como estaban:
-- columna + indice + FK RESTRICT a zona.
ALTER TABLE "tarifas" ADD COLUMN "nombre" TEXT NOT NULL;
ALTER TABLE "tarifas" ADD COLUMN "zona_id" TEXT NOT NULL;
CREATE INDEX "tarifas_zona_id_idx" ON "tarifas"("zona_id");
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
