-- Feature 155 (T5.1, R34/R35/R36/R37/R39/R40) — RETIRO del value `en_fulfillment` del catalogo
-- `order_status`, con backfill de las ordenes vivas que sigan en ese estado.
--
-- CONTEXTO. Hasta la 155 una orden de una tienda con `fulfillment = true` nacia en
-- `en_fulfillment`. La 155 sustituye esa regla: esas ordenes nacen ahora en `en_preparacion`, y
-- el value sale de `ORDER_STATUS_SEED`, de `TRANSICIONES` (con sus cuatro aristas #1/#2/#3/#7b)
-- y de `ESTADOS_CREACION`. Esta migracion es la mitad de DATOS de ese retiro, y es lo que hace
-- que retirar las aristas no atrape a nadie: cuando el codigo nuevo corre, el conjunto de
-- ordenes en `en_fulfillment` es VACIO. La guardia de transiciones de la feature 140 falla
-- CERRADO, asi que una orden que se quedara ahi no tendria NINGUNA salida legal.
--
-- ORDEN DE LOS PASOS. El rastro (1) va ANTES del backfill (2) porque se calcula sobre las filas
-- que TODAVIA estan en `en_fulfillment`: al reves no encontraria ninguna.
--
-- SIN EFECTOS DE NEGOCIO (R40). Es SQL puro: no pasa por `appendCambioEstado` y, por tanto, no
-- pasa por `emitirWebhooksEstado` ni por el encolado de jobs. Ni un webhook, ni una
-- notificacion, ni un job de geocodificacion por orden migrada. Es una correccion de datos, no
-- una transicion de negocio.
--
-- TABLAS/COLUMNAS/RLS: ninguna nueva y ninguna alterada. `orden`, `orden_historial_estado` y
-- `order_status` conservan la RLS de features previas; esto es DML sobre filas existentes mas
-- un DELETE condicional de catalogo.
--
-- IDEMPOTENTE: una segunda pasada afecta 0 filas en los tres pasos (tras el backfill ya no hay
-- ordenes en `en_fulfillment`, asi que el INSERT del paso 1 selecciona vacio y el UPDATE del
-- paso 2 no encuentra nada).

-- 1. RASTRO DEL BACKFILL (R35), antes de mover nada. Una fila de historial por cada orden que
--    hoy este en `en_fulfillment`, INCLUIDAS las borradas logicamente (no se filtra por
--    `deleted_at`: R34 exige mover todas, y una orden borrada puede restaurarse).
--    Familia `ajuste_estado` (value ya existente del enum `orden_historial_origen_tipo`: esta
--    feature NO añade values, asi que no hay que tocar ningun `down.sql` previo).
--    SIN ACTOR (`NULL` = sistema, R21 de la feature 49) y con un motivo literal que identifica
--    a esta migracion. El motivo va en `motivo` —texto libre, ya nullable— y no en una tabla
--    aparte porque ADEMAS SE LEE en la linea de tiempo de la orden: el usuario ve por que su
--    orden cambio de estado sin que nadie la tocara. Un marcador oculto no daria eso, y es
--    tambien lo que hace REVERSIBLE el DOWN (sin marcador no habria forma de saber que ordenes
--    estaban en `en_fulfillment`).
INSERT INTO "orden_historial_estado"
  ("id","orden_id","estatus_origen_id","estatus_destino_id","actor_usuario_id","origen_tipo","motivo","created_at")
SELECT gen_random_uuid()::text, o."id", f."id", p."id", NULL,
       'ajuste_estado'::orden_historial_origen_tipo,
       'migracion 155: retiro de en_fulfillment', now()
FROM "orden" o
JOIN "order_status" f ON f."id" = o."estatus_id" AND f."value" = 'en_fulfillment'
CROSS JOIN "order_status" p
WHERE p."value" = 'en_preparacion';

-- 2. BACKFILL (R34). SOLO `estatus_id`: ni `num_guia`, ni `mensajero_asignado_id`, ni
--    `prioridad`, ni ningun otro campo de la orden. Tampoco `updated_at` (no se toca a mano).
--    Alcanza a las borradas logicamente, igual que el paso 1.
UPDATE "orden"
SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_preparacion')
WHERE "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_fulfillment');

-- 3. RETIRO DEL CATALOGO (R37), CONDICIONAL. Patron exacto del `down.sql` de
--    `20260724140000_order_status_devolucion_rechazadas`. Solo borra la fila si NINGUNA orden y
--    NINGUNA fila de historial la referencian.
--
--    CONSECUENCIA ASUMIDA Y EXPLICITA: en una base con historial real (produccion) este paso es
--    NO-OP y la fila del catalogo SOBREVIVE, referenciada solo por el historial. Queda
--    INALCANZABLE desde la aplicacion (no esta en `ORDER_STATUS_SEED`, ni en `TRANSICIONES`, ni
--    en `ESTADOS_CREACION`, ni en ningun mapa de UI). En una base sin ese historial (dev limpia,
--    CI) desaparece. Es la diferencia entre "borrar el value" y "borrar la historia": aqui solo
--    se borra el primero.
--
--    POR QUE NO SE FUERZA EL BORRADO (R36): `orden_historial_estado.estatus_destino_id` es
--    obligatorio y `estatus_origen_id` es opcional. Un DELETE en cascada o con SET NULL
--    convertiria filas de origen legitimo en filas con origen NULL, que es EXACTAMENTE el
--    marcador de "creacion". Borrar la fila corromperia la linea de tiempo pasada, que es
--    inmutable y alimenta el derivador de intentos de entrega (y de ahi, dinero).
DELETE FROM "order_status" os
WHERE os."value" = 'en_fulfillment'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h
                  WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
