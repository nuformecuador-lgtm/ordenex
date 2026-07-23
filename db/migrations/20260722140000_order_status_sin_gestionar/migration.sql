-- Feature 109 (T0.2, R1/R2): agrega el estado 'sin_gestionar' al catalogo `order_status`
-- (tabla de valores, no enum tras 20260714123909). Idempotente: WHERE NOT EXISTS por `value`
-- (unico), patron `20260715120000_order_status_recibido_origen`. No cambia el estatus inicial
-- por defecto (`en_preparacion`/`en_fulfillment`, lib/config/ordenes.ts) ni define transiciones;
-- solo agrega el valor al catalogo. ADITIVA: no toca columnas ni RLS de ninguna tabla.
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'sin_gestionar'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'sin_gestionar');
