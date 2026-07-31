-- DOWN (feature 157, estado `recolectando`) — revierte EXACTAMENTE lo que hace el UP, en orden
-- inverso: primero devuelve las ordenes a su estado anterior, y solo entonces borra la fila del
-- catalogo (que ya no puede estar referenciada por ninguna orden).
--
-- 1. Las ordenes vuelven a `por_recolectar_en_tienda` conservando su mensajero, que es
--    exactamente el estado del que salieron: el comportamiento viejo era "asignada pero en el
--    mismo estado". No se distingue entre las que backfilleó la migracion y las que llegaron
--    despues por uso normal, porque el estado del que vienen es el mismo y el mensajero se
--    conserva en ambos casos.
UPDATE "orden"
SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'por_recolectar_en_tienda')
WHERE "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'recolectando');

-- 2. Rastro de la reversion, con la MISMA familia que uso el UP (correccion de datos, sin
--    actor). Se calcula DESPUES del UPDATE porque ahora las filas ya estan en el destino.
INSERT INTO "orden_historial_estado"
  ("id","orden_id","estatus_origen_id","estatus_destino_id","actor_usuario_id","origen_tipo","motivo","created_at")
SELECT gen_random_uuid()::text, o."id", origen."id", destino."id", NULL,
       'ajuste_estado'::orden_historial_origen_tipo,
       'rollback 157: se retira el estado recolectando', now()
FROM "orden" o
JOIN "order_status" destino ON destino."id" = o."estatus_id" AND destino."value" = 'por_recolectar_en_tienda'
CROSS JOIN "order_status" origen
WHERE origen."value" = 'recolectando'
  AND o."mensajero_asignado_id" IS NOT NULL;

-- 3. RETIRO DEL CATALOGO, CONDICIONAL — mismo patron que el retiro de la 155. Solo borra la
--    fila si NINGUNA orden y NINGUNA fila de historial la referencian. En una base con
--    historial real este paso es NO-OP y la fila SOBREVIVE, inalcanzable desde el codigo
--    (fuera de `ORDER_STATUS_SEED`): borrarla mutilaria la linea de tiempo pasada, que es
--    inmutable y alimenta derivaciones de negocio.
DELETE FROM "order_status" os
WHERE os."value" = 'recolectando'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h
                  WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
