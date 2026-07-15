-- Revierte SOLO los 7 estados que esta migracion agrego (los otros 6 y 'pendiente'
-- vienen de migraciones previas). Best-effort: no borra un estado referenciado por
-- alguna orden o transicion de historial (respeta las FKs).
DELETE FROM "order_status" os
WHERE os."value" IN (
    'entregada','devuelta','devuelta_origen','reprogramada',
    'en_fulfillment','en_ruta_bodega_principal','en_bodega'
  )
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (
    SELECT 1 FROM "orden_historial_estado" h
    WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id"
  );
