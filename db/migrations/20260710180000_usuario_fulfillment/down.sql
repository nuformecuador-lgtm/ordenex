-- DOWN: revierte exactamente migration.sql de esta carpeta (R2).
-- Elimina la columna "fulfillment" de "usuario", dejando el esquema exactamente
-- como estaba antes de la migracion. No toca ninguna otra tabla.

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "fulfillment";
