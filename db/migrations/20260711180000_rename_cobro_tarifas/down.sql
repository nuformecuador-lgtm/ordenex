-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.

-- Revierte CreateTable tarifa_zona_mensajero (incluye sus FKs/indices).
DROP TABLE IF EXISTS "tarifa_zona_mensajero";

-- Revierte AlterTable zona.
ALTER TABLE "zona" DROP COLUMN IF EXISTS "cobro_vehiculo";

-- Revierte AddForeignKey/CreateIndex/AlterTable de tarifas.zona_id.
ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey";
DROP INDEX IF EXISTS "tarifas_zona_id_idx";
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "zona_id";

-- Revierte RenameTable: vuelve a dejar la tabla como "cobro".
ALTER INDEX "tarifas_created_at_idx" RENAME TO "cobro_created_at_idx";
ALTER TABLE "tarifas" RENAME CONSTRAINT "tarifas_pkey" TO "cobro_pkey";
ALTER TABLE "tarifas" RENAME TO "cobro";
