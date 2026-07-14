-- DOWN (R21): revierte exactamente migration.sql — recrea el enum
-- `wallet_movimiento_categoria` SIN los dos valores nuevos (egreso_gasto_fijo,
-- egreso_gasto_variable). Espejo del down de `cierre_estado_vencido` (feature 41).
--
-- Precondicion (R21): NINGUNA fila de "wallet_movimiento" debe usar `egreso_gasto_fijo`
-- ni `egreso_gasto_variable`. Postgres no soporta DROP VALUE de un enum, asi que el tipo
-- se recrea sin ellos; si existiera una fila con esos valores el USING cast
-- ('...'::text::"wallet_movimiento_categoria") FALLA y el rollback aborta con un error
-- claro (correcto: revertir con egresos ya emitidos no es seguro).
--
-- La columna `wallet_movimiento.categoria` NO tiene DEFAULT (no hace falta DROP DEFAULT).
-- Se sueltan/recrean los DOS indices que referencian `categoria` alrededor del cambio de
-- tipo (sus literales/tipos quedarian ligados al tipo VIEJO durante el ALTER COLUMN).
-- NO se toca la RLS de wallet_movimiento (R20).

DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";
DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";

ALTER TYPE "wallet_movimiento_categoria" RENAME TO "wallet_movimiento_categoria_old";
CREATE TYPE "wallet_movimiento_categoria" AS ENUM (
  'ingreso_flete',
  'ingreso_flete_devolucion',
  'ingreso_comision_cod',
  'ingreso_iva_flete',
  'ingreso_iva_flete_devolucion',
  'ingreso_iva_comision_cod',
  'ingreso_ajuste',
  'egreso_pago_tienda',
  'egreso_pago_mensajero',
  'egreso_gasto',
  'egreso_sueldo',
  'egreso_ajuste'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"
  TYPE "wallet_movimiento_categoria" USING ("categoria"::text::"wallet_movimiento_categoria");
DROP TYPE "wallet_movimiento_categoria_old";

-- Recrea los dos indices tal cual estaban en la migracion de la 42 (mismos nombres/forma).
CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"("tipo", "categoria");
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo", "origen_id", "categoria")
  WHERE "origen_id" IS NOT NULL;
