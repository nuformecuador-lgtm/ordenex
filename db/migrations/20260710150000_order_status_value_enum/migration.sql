-- Enum Postgres standalone para estados de orden (feature 28, R9). Patron CREATE TYPE "rol_value".
-- STANDALONE: NO retipa la columna order_status.value (sigue TEXT). 8 valores == ORDER_STATUS_SEED.
CREATE TYPE "order_status_value" AS ENUM (
  'entregada','devuelta','devuelta_origen','reprogramada',
  'en_fulfillment','en_ruta_bodega_principal','en_bodega','en_preparacion'
);
