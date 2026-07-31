-- Feature 157 (ampliacion) — estado `recolectando` + backfill de las ya asignadas.
--
-- QUE ARREGLA. La asignacion del mensajero que va a la tienda NO transicionaba: la orden se
-- quedaba en `por_recolectar_en_tienda` con el mensajero escrito. Consecuencia reportada desde
-- produccion: esas ordenes seguian saliendo como asignables y se podian reasignar
-- INDEFINIDAMENTE, porque nada en su estado decia que alguien ya iba en camino a por ellas.
-- Con un estado propio, la asignacion pasa a ser una transicion de verdad: sale del monton de
-- "sin asignar", queda en el historial quien asigno y cuando, y para cambiar de mensajero hay
-- que revertir explicitamente (decision del humano 2026-07-31).
--
-- `order_status` es TABLA de valores, no enum (`20260714123909_reconcile_fks_drop_order_status_value`
-- hizo el camino enum -> tabla para poder referenciarlo por FK), asi que el alta es un INSERT.
--
-- IDEMPOTENTE: `INSERT ... SELECT ... WHERE NOT EXISTS` por `value` (indice unico
-- `order_status_value_key`), y el backfill de abajo no encuentra nada en una segunda pasada.
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'recolectando'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'recolectando');

-- BACKFILL (decision del humano): las ordenes que HOY estan en `por_recolectar_en_tienda` CON
-- mensajero asignado ya son, de hecho, recolecciones en curso — se asignaron con el
-- comportamiento viejo—. Se mueven al estado nuevo para que el flujo quede coherente desde el
-- primer momento; si se quedaran donde estan, seguirian siendo reasignables sin limite hasta
-- que alguien las tocara a mano.
--
-- ORDEN DE LOS PASOS: el rastro (1) va ANTES del UPDATE (2) porque se calcula sobre las filas
-- que TODAVIA cumplen la condicion; al reves no encontraria ninguna.
--
-- La familia del rastro es `ajuste_estado`, NO `asignacion_recoleccion`: esto es una correccion
-- de datos hecha por la migracion, no una asignacion que alguien decidio. Ademas Postgres no
-- permite USAR un valor de enum en la misma transaccion que lo añadio, y
-- `asignacion_recoleccion` se añade en la migracion inmediatamente anterior. Mismo criterio y
-- mismo patron que el backfill de la 155 (`20260729140000_order_status_retiro_en_fulfillment`).
--
-- SIN EFECTOS DE NEGOCIO: es SQL puro, no pasa por `appendCambioEstado` ni por el encolado de
-- jobs, asi que no emite webhooks ni notificaciones. `mensajero_asignado_id` NO se toca (sigue
-- siendo suya) y `asignado_at` tampoco: esa columna es el denominador del ranking y una
-- recoleccion no debe contar (R38).
INSERT INTO "orden_historial_estado"
  ("id","orden_id","estatus_origen_id","estatus_destino_id","actor_usuario_id","origen_tipo","motivo","created_at")
SELECT gen_random_uuid()::text, o."id", origen."id", destino."id", NULL,
       'ajuste_estado'::orden_historial_origen_tipo,
       'migracion 157: la asignacion de recoleccion pasa a estado propio', now()
FROM "orden" o
JOIN "order_status" origen ON origen."id" = o."estatus_id" AND origen."value" = 'por_recolectar_en_tienda'
CROSS JOIN "order_status" destino
WHERE destino."value" = 'recolectando'
  AND o."mensajero_asignado_id" IS NOT NULL;

UPDATE "orden"
SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'recolectando')
WHERE "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'por_recolectar_en_tienda')
  AND "mensajero_asignado_id" IS NOT NULL;
