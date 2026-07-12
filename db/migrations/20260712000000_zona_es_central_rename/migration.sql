-- Feature 54: reconciliacion del refactor de tarifas/zonas (PR #40).
-- Rename es_gam -> es_central (flag de zona central, antes GAM). Preserva el dato
-- y la invariante "a lo sumo una zona central" via el indice unico parcial.
ALTER TABLE "zona" RENAME COLUMN "es_gam" TO "es_central";
ALTER INDEX "zona_es_gam_unico" RENAME TO "zona_es_central_unico";
-- Los pagos al mensajero se movieron a tarifa_zona_mensajero (refactor tarifas):
-- pago_entrega/pago_rechazo son columnas muertas en zona.
ALTER TABLE "zona" DROP COLUMN "pago_entrega";
ALTER TABLE "zona" DROP COLUMN "pago_rechazo";
