-- Feature 154 (T1.1, R1/R2/R3/R4): agrega los DOS estados nuevos del flujo v2 al catalogo
-- `order_status` (TABLA de valores, no enum: `20260714123909_reconcile_fks_drop_order_status_value`
-- hizo el camino enum -> tabla para poder referenciarlo por FK). Por eso el alta es un INSERT,
-- no un `ALTER TYPE ADD VALUE`.
--   - `por_recolectar_en_tienda` (19.o value): la orden nace en la tienda y espera que el
--     mensajero la RECOLECTE ahi; su salida es hacia `en_ruta_bodega_central` (feature 157).
--   - `incidente` (20.o value): resultado TERMINAL de la gestion del mensajero (feature 158).
--
-- IDEMPOTENTE (R4): un `INSERT ... SELECT ... WHERE NOT EXISTS` por `value` (indice unico
-- `order_status_value_key`); reaplicarla deja 20 filas y ningun duplicado. Patron EXACTO de
-- `20260724140000_order_status_devolucion_rechazadas/migration.sql` (feature 139).
--
-- ADITIVA (R3): no renombra, no reordena y no borra ninguno de los 18 values previos; no toca
-- columnas, tablas ni RLS (`order_status` conserva la RLS de features previas). No cambia el
-- estatus inicial por defecto ni declara transiciones (eso vive en `lib/types/`).
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'por_recolectar_en_tienda'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'por_recolectar_en_tienda');

INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'incidente'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'incidente');
