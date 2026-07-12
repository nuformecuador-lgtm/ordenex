-- Revierte 20260712000000_zona_es_central_rename en orden inverso.
ALTER TABLE "zona" ADD COLUMN "pago_rechazo" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "zona" ADD COLUMN "pago_entrega" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER INDEX "zona_es_central_unico" RENAME TO "zona_es_gam_unico";
ALTER TABLE "zona" RENAME COLUMN "es_central" TO "es_gam";
