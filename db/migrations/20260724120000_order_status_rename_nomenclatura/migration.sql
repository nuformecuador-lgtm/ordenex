-- Feature 135 (R2): rename in-place del VALUE de catalogo order_status. UPDATE conserva
-- el id de cada fila y por tanto las FKs orden.estatus_id / historial.*_id (R4). No hay
-- enum Postgres (order_status_value fue dropeado en 20260714123909): sin ALTER TYPE.
-- Idempotente (0 filas si el value antiguo no existe). Orden-independiente: ningun value
-- nuevo colisiona con un value antiguo aun presente (value es UNIQUE). El WHERE por
-- igualdad EXACTA no toca en_bodega_satelite ni en_ruta_bodega_satelite (R11).
UPDATE "order_status" SET "value" = 'en_ruta'                WHERE "value" = 'en_reparto';
UPDATE "order_status" SET "value" = 'por_recoger'            WHERE "value" = 'en_espera_aceptacion';
UPDATE "order_status" SET "value" = 'en_bodega_central'      WHERE "value" = 'en_bodega';
UPDATE "order_status" SET "value" = 'en_ruta_bodega_central' WHERE "value" = 'en_ruta_bodega_principal';
UPDATE "order_status" SET "value" = 'devolviendo_a_tienda'   WHERE "value" = 'devuelta_origen';
UPDATE "order_status" SET "value" = 'devuelta_a_tienda'      WHERE "value" = 'recibido_origen';
