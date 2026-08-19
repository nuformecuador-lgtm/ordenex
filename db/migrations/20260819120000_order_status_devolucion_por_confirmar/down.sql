-- DOWN (feature 239, pre-estado `devolucion_por_confirmar`) — RETIRO CONDICIONAL del catalogo.
--
-- Patron de la 155 (`20260729140000_order_status_retiro_en_fulfillment`) y de la 157
-- (`20260731130000_order_status_recolectando`): la fila SOLO se borra si NADIE la referencia,
-- ni desde `orden` ni desde `orden_historial_estado`.
--
-- En una base con historial real este DELETE es NO-OP y la fila SOBREVIVE HUERFANA,
-- deliberadamente inalcanzable desde el codigo (fuera de `ORDER_STATUS_SEED`): el historial es
-- APPEND-ONLY y no se reescribe (R32). Borrar la fila mutilaria la linea de tiempo pasada, que
-- es inmutable y alimenta derivaciones de negocio (el ancla del SLA, entre otras).
--
-- NO se mueve ninguna orden (R31): a diferencia del down de la 157, este NO hace `UPDATE orden
-- SET estatus_id = ...`. Si al revertir quedaran ordenes EN el pre-estado, la fila del catalogo
-- se conserva y esas ordenes siguen siendo legibles por el codigo anterior — que las vera como
-- un estatus desconocido y las pintara con el chip neutro (`EstatusBadge`, R41 de la 155) en vez
-- de romper. Ese es el estado que R32 exige: la base queda LEGIBLE para el codigo anterior.
DELETE FROM "order_status" os
WHERE os."value" = 'devolucion_por_confirmar'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h
                  WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
