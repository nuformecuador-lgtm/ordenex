-- Feature 153 (R2): rename in-place del VALUE de catalogo order_status: en_ruta -> en_reparto.
-- UPDATE conserva el id de la fila y por tanto las FKs orden.estatus_id / historial.*_id (R4).
-- No hay enum Postgres (order_status_value fue dropeado en 20260714123909): sin ALTER TYPE.
-- Idempotente (0 filas si el value antiguo no existe). El WHERE por igualdad EXACTA no toca
-- en_ruta_bodega_central ni en_ruta_bodega_satelite (R5). Revierte, solo para este value, el
-- rename de 20260724120000 (feature 135).
UPDATE "order_status" SET "value" = 'en_reparto' WHERE "value" = 'en_ruta';
