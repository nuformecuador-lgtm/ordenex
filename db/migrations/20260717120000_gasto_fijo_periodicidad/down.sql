-- DOWN: revierte exactamente migration.sql. Deja `gasto_fijo_plantilla` como estaba pre-84
-- (concepto/monto/activa/created_at/updated_at), con su RLS y su indice por `activa` intactos:
-- esta migracion no los toco. Al volver, el cron queda mensual dia 1 por el codigo (vercel.json
-- + service), no por el esquema.
--
-- Orden inverso al UP: primero el CHECK, despues las columnas (DROP COLUMN arrastra su default),
-- y al final el enum — que solo se puede eliminar cuando ya no queda ninguna columna usandolo.
ALTER TABLE "gasto_fijo_plantilla"
  DROP CONSTRAINT IF EXISTS "gasto_fijo_plantilla_periodicidad_cantidad_check";

ALTER TABLE "gasto_fijo_plantilla"
  DROP COLUMN IF EXISTS "fecha_cobro",
  DROP COLUMN IF EXISTS "periodicidad_cantidad",
  DROP COLUMN IF EXISTS "periodicidad_unidad";

DROP TYPE IF EXISTS "PeriodicidadUnidad";
