-- Agrega el estado 'pendiente' al catalogo `order_status` (tabla de valores, no enum
-- tras 20260714123909). Idempotente: WHERE NOT EXISTS por `value` (unico). No cambia
-- el estatus inicial por defecto (`en_preparacion`/`en_fulfillment`, lib/config/ordenes.ts)
-- ni define transiciones; solo agrega el valor al catalogo.
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'pendiente'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'pendiente');
