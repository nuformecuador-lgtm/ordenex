-- DOWN (T1.1, R4): revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso.
--
-- PRECONDICION (R4, documentada como en el resto del repo): NINGUNA fila persistida puede
-- usar los valores que se retiran —
--   - `gestion_orden.resultado = 'incidente'`
--   - `wallet_movimiento.categoria = 'egreso_indemnizacion'`
-- Postgres no soporta `DROP VALUE` de un enum, asi que los dos tipos se RECREAN sin el valor
-- nuevo; si existiera una fila con el, el `USING ('...'::text::"<tipo>")` FALLA y el rollback
-- ABORTA con un error claro, sin dejar la base a medias. Es el comportamiento CORRECTO:
-- revertir con indemnizaciones ya emitidas no es seguro. Espejo del down de
-- `20260713140000_wallet_egreso_gasto_fijo_variable` (feature 45).
--
-- NO se tocan RLS ni policies (la migracion tampoco las toco).
-- NO se reescribe ningun `down.sql` PREVIO (decision Q-F): el de la 45 lista 12 valores
-- porque ese era su estado punto-en-el-tiempo, y `gestion_resultado` no lo recrea ningun down
-- anterior (el unico que lo toca, 20260711150000, hace `DROP TYPE IF EXISTS`).

-- 5) Monto de la indemnizacion (se pierden los montos capturados: es el reverso EXACTO de la
-- migracion, igual que el down de la 73 pierde las causas).
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "indemnizacion";

-- 4) Causa del incidente. Se suelta ANTES que su tipo: mientras exista, el DROP TYPE falla.
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "causa_incidente";

-- 1) Enum de la causa (ya sin ninguna columna usuaria tras el DROP COLUMN de arriba).
DROP TYPE IF EXISTS "gestion_causa_incidente";

-- 3) Categoria de la caja principal: se recrea el enum con los 14 valores previos. Se
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
  'egreso_gasto_variable'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"
  TYPE "wallet_movimiento_categoria" USING ("categoria"::text::"wallet_movimiento_categoria");
DROP TYPE "wallet_movimiento_categoria_old";

-- Recrea los dos indices tal cual estaban en la migracion de la 42 (mismos nombres/forma).
CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"("tipo", "categoria");
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo", "origen_id", "categoria")
  WHERE "origen_id" IS NOT NULL;

-- 2) Resultado de la gestion: se recrea el enum con los 4 valores previos. La columna
-- `gestion_orden.resultado` NO tiene DEFAULT y NINGUN indice la referencia (los de
-- `gestion_orden` son de orden_id, mensajero_id, cierre_id, anulada_por y el PARCIAL de la 67
-- sobre `(mensajero_id) WHERE cierre_id IS NULL AND anulada_at IS NULL`), asi que no hay
-- indices que soltar aqui.
ALTER TYPE "gestion_resultado" RENAME TO "gestion_resultado_old";
CREATE TYPE "gestion_resultado" AS ENUM (
  'entregada',
  'reprogramada',
  'devuelta',
  'rechazada'
);
ALTER TABLE "gestion_orden" ALTER COLUMN "resultado"
  TYPE "gestion_resultado" USING ("resultado"::text::"gestion_resultado");
DROP TYPE "gestion_resultado_old";
