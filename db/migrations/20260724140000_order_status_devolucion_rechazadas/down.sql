-- DOWN (T0.2, R2): revierte los TRES estados del flujo de devolucion de rechazadas. Los borra
-- SOLO si NINGUNA orden ni transicion de historial los referencia (best-effort; no rompe FKs).
-- Patron EXACTO de `20260722140000_order_status_sin_gestionar/down.sql`. NO toca RLS ni columnas.
DELETE FROM "order_status" os
WHERE os."value" IN ('por_devolver', 'devolviendo_a_bodega_central', 'por_devolver_a_tienda')
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
