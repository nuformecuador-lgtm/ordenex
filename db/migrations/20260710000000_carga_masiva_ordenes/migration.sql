-- Feature 15 (carga masiva): extiende "orden" con columnas para la carga por
-- archivo (direccion, monto_cobrar, mensajero_sugerido_id), vuelve "peso"
-- nullable (R4) y agrega el estatus "en_preparacion" al catalogo (R6), que
-- pasa a ser el default GLOBAL de creacion (R7/R8, ver lib/config/ordenes.ts).
-- "orden" ya tiene RLS habilitada desde la migracion 20260709130100_ordenes;
-- se conserva sin cambios, sin agregar policies (acceso solo por service role).

-- AlterTable: peso pasa a nullable (R4, las ordenes de carga masiva no traen peso)
ALTER TABLE "orden" ALTER COLUMN "peso" DROP NOT NULL;

-- AlterTable: columnas nuevas (R1), todas nullable
ALTER TABLE "orden" ADD COLUMN "direccion" TEXT;
ALTER TABLE "orden" ADD COLUMN "monto_cobrar" DECIMAL(12,2);
ALTER TABLE "orden" ADD COLUMN "mensajero_sugerido_id" TEXT;

-- CreateIndex (R2)
CREATE INDEX "orden_mensajero_sugerido_id_idx" ON "orden"("mensajero_sugerido_id");

-- AddForeignKey (R2): mensajero sugerido nullable, ON DELETE SET NULL
ALTER TABLE "orden" ADD CONSTRAINT "orden_mensajero_sugerido_id_fkey" FOREIGN KEY ("mensajero_sugerido_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed idempotente del nuevo estatus (R6): cubre bases ya migradas donde el
-- script de seed (seedOrderStatus) pudiera no volver a ejecutarse.
INSERT INTO "order_status" ("id","value") VALUES (gen_random_uuid()::text,'en_preparacion') ON CONFLICT ("value") DO NOTHING;
