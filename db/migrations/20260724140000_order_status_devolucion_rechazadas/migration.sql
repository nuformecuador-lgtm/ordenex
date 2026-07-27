-- Feature 139 (T0.2, R1/R2): agrega los TRES estados nuevos del flujo de DEVOLUCION de
-- RECHAZADAS al catalogo `order_status` (tabla de valores, no enum tras 20260714123909):
-- `por_devolver`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda`. Idempotente:
-- un `INSERT ... WHERE NOT EXISTS` por `value` (unico), patron EXACTO de
-- `20260722140000_order_status_sin_gestionar/migration.sql`. No cambia el estatus inicial
-- por defecto ni define transiciones; solo agrega los valores al catalogo. ADITIVA: no toca
-- columnas ni RLS de ninguna tabla (`order_status` conserva su RLS de features previas).
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'por_devolver'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'por_devolver');

INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'devolviendo_a_bodega_central'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'devolviendo_a_bodega_central');

INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'por_devolver_a_tienda'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'por_devolver_a_tienda');
