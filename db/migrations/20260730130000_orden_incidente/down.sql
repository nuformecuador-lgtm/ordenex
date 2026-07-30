-- DOWN (T1.19, R40): revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso.
--
-- PRECONDICION (R40, documentada como en el resto del repo): NINGUNA fila persistida puede usar
-- el valor que se retira —
--   - `wallet_movimiento.origen_tipo        = 'orden_incidente'`
--   - `wallet_tienda_movimiento.origen_tipo = 'orden_incidente'`
--   - `pago_mensajero_movimiento.origen_tipo = 'orden_incidente'`
-- Postgres no soporta `DROP VALUE` de un enum, asi que el tipo se RECREA sin el valor nuevo; si
-- existiera una fila con el, el `USING ('...'::text::"wallet_origen_tipo")` FALLA y el rollback
-- ABORTA con un error claro, sin dejar la base a medias. Es el comportamiento CORRECTO: revertir
-- con indemnizaciones ya emitidas no es seguro.
--
-- ⚠️ LAS TRES TABLAS, NO UNA. `wallet_origen_tipo` lo usan `wallet_movimiento` (42),
-- `wallet_tienda_movimiento` (43) y `pago_mensajero_movimiento` (44). Olvidar cualquiera de las
-- tres deja el tipo `wallet_origen_tipo_old` con una columna dependiente y el `DROP TYPE` falla,
-- abortando el rollback a mitad. Los SEIS indices que referencian `origen_tipo` (dos por tabla,
-- uno de ellos el UNICO PARCIAL de la idempotencia) se sueltan y se recrean alrededor del cambio
-- de tipo, con el MISMO nombre y la MISMA forma — patron del down de la 45 y del de la 158/PR1.
--
-- NO se reescribe ningun `down.sql` PREVIO (decision Q-F, design §0.7): verificado que NINGUN
-- down anterior RECREA `wallet_origen_tipo` — el unico que lo toca (20260712160000) hace
-- `DROP TYPE IF EXISTS`. Asi que este valor nuevo no obliga a tocar ninguno.

-- 3) Evidencias primero: su FK apunta a `orden_incidente` (el DROP TABLE arrastra sus indices).
DROP TABLE IF EXISTS "orden_incidente_evidencia";

-- 2) El incidente (el DROP TABLE arrastra FKs e indices, incluido el UNICO PARCIAL
-- `orden_incidente_orden_vivo_uq`). Los enums `gestion_causa_incidente` (158/PR1) y
-- `cierre_estado` (37) NO se tocan: son de otras migraciones.
DROP TABLE IF EXISTS "orden_incidente";

-- 1) Origen del movimiento: se recrea el enum con los 6 valores previos. Ninguna de las tres
-- columnas `origen_tipo` tiene DEFAULT (no hace falta DROP DEFAULT).
DROP INDEX IF EXISTS "wallet_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_origen_uq";
DROP INDEX IF EXISTS "pago_mensajero_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "pago_mensajero_movimiento_origen_uq";

ALTER TYPE "wallet_origen_tipo" RENAME TO "wallet_origen_tipo_old";
CREATE TYPE "wallet_origen_tipo" AS ENUM (
  'cierre_dia',
  'gestion_orden',
  'manual',
  'pago_tienda',
  'pago_mensajero',
  'gasto'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
ALTER TABLE "wallet_tienda_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
ALTER TABLE "pago_mensajero_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
DROP TYPE "wallet_origen_tipo_old";

-- Recrea los seis indices tal cual estaban en las migraciones de 42/43/44 (mismos nombres,
-- misma forma, mismos predicados parciales).
CREATE INDEX "wallet_movimiento_origen_tipo_origen_id_idx"
  ON "wallet_movimiento"("origen_tipo", "origen_id");
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo", "origen_id", "categoria")
  WHERE "origen_id" IS NOT NULL;
CREATE INDEX "wallet_tienda_movimiento_origen_tipo_origen_id_idx"
  ON "wallet_tienda_movimiento"("origen_tipo", "origen_id");
CREATE UNIQUE INDEX "wallet_tienda_movimiento_origen_uq"
  ON "wallet_tienda_movimiento"("origen_tipo", "origen_id", "tienda_id", "categoria")
  WHERE "origen_id" IS NOT NULL;
CREATE INDEX "pago_mensajero_movimiento_origen_tipo_origen_id_idx"
  ON "pago_mensajero_movimiento"("origen_tipo", "origen_id");
CREATE UNIQUE INDEX "pago_mensajero_movimiento_origen_uq"
  ON "pago_mensajero_movimiento"("origen_tipo", "origen_id", "mensajero_id", "categoria")
  WHERE "origen_id" IS NOT NULL;
