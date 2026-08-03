-- DOWN (T A.1, R49): revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso.
--
-- PRECONDICION (documentada como en el resto del repo): NINGUNA fila persistida puede usar los
-- valores que se retiran —
--   - `wallet_movimiento.categoria = 'ingreso_cod_recaudado'`
--   - `wallet_movimiento.categoria = 'ingreso_reverso_pago_tienda'`
-- Postgres no soporta `DROP VALUE` de un enum, asi que el tipo se RECREA sin los valores
-- nuevos; si existiera una fila con alguno, el `USING ('...'::text::"wallet_movimiento_categoria")`
-- FALLA y el rollback ABORTA con un error claro, sin dejar la base a medias. Es el
-- comportamiento CORRECTO: revertir con contra-entrega ya registrado en la caja NO es seguro
-- —el reverso de un libro append-only de dinero no puede ser un borrado silencioso—. Espejo
-- del down de `20260730120000_incidente_indemnizacion` (feature 158) y del de la 45.
--
-- NO se tocan RLS ni policies (la migracion tampoco las toco).
-- NO se reescribe ningun `down.sql` PREVIO (R50, decision ya tomada en el repo): el de la 45
-- lista 12 valores y el de la 158 lista 14 porque ese era su estado punto-en-el-tiempo. El que
-- cuadra con el SEED vigente menos los dos valores que esta migracion anade es ESTE, con 15.

-- Categoria de la caja principal: se recrea el enum con los 15 valores previos. Se
-- sueltan/recrean los DOS indices que referencian `categoria` alrededor del cambio de tipo
-- (sus literales/tipos quedarian ligados al tipo VIEJO durante el ALTER COLUMN). La columna
-- `wallet_movimiento.categoria` NO tiene DEFAULT (no hace falta DROP DEFAULT).
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
  'egreso_ajuste',
  'egreso_gasto_fijo',
  'egreso_gasto_variable',
  'egreso_indemnizacion'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"
  TYPE "wallet_movimiento_categoria" USING ("categoria"::text::"wallet_movimiento_categoria");
DROP TYPE "wallet_movimiento_categoria_old";

-- Recrea los dos indices tal cual estaban en la migracion de la 42 (mismos nombres/forma).
CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"("tipo", "categoria");
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo", "origen_id", "categoria")
  WHERE "origen_id" IS NOT NULL;
