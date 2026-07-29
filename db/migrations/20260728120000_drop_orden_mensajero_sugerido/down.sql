-- Revierte 20260728120000_drop_orden_mensajero_sugerido.
--
-- Restaura la ESTRUCTURA (columna + indice + FK) tal como la creo
-- `20260710000000_carga_masiva_ordenes`, para que bajar por debajo de esta
-- migracion deje el esquema exactamente como estaba.
--
-- NO restaura los DATOS: el DROP COLUMN los elimina de forma irreversible y no
-- hay tabla de respaldo. Tras un rollback todas las ordenes quedan con
-- `mensajero_sugerido_id` NULL, que es un estado valido (la columna siempre fue
-- nullable y el flujo la trataba como opcional).

ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "mensajero_sugerido_id" TEXT;

CREATE INDEX IF NOT EXISTS "orden_mensajero_sugerido_id_idx" ON "orden"("mensajero_sugerido_id");

ALTER TABLE "orden"
  ADD CONSTRAINT "orden_mensajero_sugerido_id_fkey"
  FOREIGN KEY ("mensajero_sugerido_id") REFERENCES "usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
