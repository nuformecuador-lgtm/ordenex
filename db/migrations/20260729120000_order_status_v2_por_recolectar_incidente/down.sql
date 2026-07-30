-- DOWN (T1.2, R5/R6): revierte el alta de los DOS estados del flujo v2. Los borra SOLO si
-- NINGUNA orden ni fila de historial los referencia; con el catalogo limpio deja exactamente
-- los 18 values previos (R5). Patron EXACTO del `down.sql` de
-- `20260724140000_order_status_devolucion_rechazadas` (feature 139).
--
-- Es BEST-EFFORT a proposito (R6): si alguna `orden.estatus_id` o alguna
-- `orden_historial_estado.estatus_origen_id/estatus_destino_id` apunta a estos values, el DELETE
-- no borra esa fila y el rollback NO falla — conservar el value es lo correcto: borrarlo rompiendo
-- una FK (o dejando historial huerfano) destruiria auditoria. En esta feature nadie los produce
-- (ningun service los escribe hasta la 155/157/158), asi que el caso normal es "0 referencias".
--
-- NO toca RLS, columnas, indices ni ninguno de los 18 values previos.
DELETE FROM "order_status" os
WHERE os."value" IN ('por_recolectar_en_tienda', 'incidente')
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
