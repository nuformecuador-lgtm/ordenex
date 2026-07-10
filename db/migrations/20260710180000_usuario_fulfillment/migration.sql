-- Feature 27: fulfillment de tienda.
-- Agrega la columna booleana "fulfillment" a "usuario" (NOT NULL DEFAULT false).
-- El DEFAULT false cubre a todos los usuarios existentes sin backfill adicional
-- (R1/R3). No modifica ninguna otra tabla ni migracion previa.

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN "fulfillment" BOOLEAN NOT NULL DEFAULT false;
