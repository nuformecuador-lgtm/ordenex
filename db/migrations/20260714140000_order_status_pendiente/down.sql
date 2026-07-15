-- Revierte el estado 'pendiente'. Solo lo borra si NINGUNA orden ni transicion de
-- historial lo referencia (best-effort; no rompe FKs).
DELETE FROM "order_status" os
WHERE os."value" = 'pendiente'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
