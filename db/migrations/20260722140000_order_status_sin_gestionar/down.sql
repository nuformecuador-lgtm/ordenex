-- DOWN (T0.2, R2): revierte el estado 'sin_gestionar'. Solo lo borra si NINGUNA orden ni
-- transicion de historial lo referencia (best-effort; no rompe FKs). Patron EXACTO de
-- `20260715120000_order_status_recibido_origen/down.sql`. NO toca RLS ni columnas.
DELETE FROM "order_status" os
WHERE os."value" = 'sin_gestionar'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
