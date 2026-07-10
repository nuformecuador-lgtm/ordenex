-- Rename in-place del valor de catalogo order_status: embalaje -> en_fulfillment (feature 28, R3).
-- UPDATE conserva el id de la fila y por tanto las FKs orden.estatus_id. Idempotente: 0 filas si no existe 'embalaje'.
UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje';
