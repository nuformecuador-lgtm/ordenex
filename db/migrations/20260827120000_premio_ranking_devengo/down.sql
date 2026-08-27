-- DOWN (293/T1.2, design §10): revierte EXACTAMENTE migration.sql de esta carpeta, en orden
-- inverso y con la coreografia de indices que exige Postgres.
--
-- PRECONDICION (documentada como en el resto del repo): NINGUNA fila persistida puede usar los
-- valores que se retiran —
--   - `pago_mensajero_movimiento.categoria  = 'premio_ranking'`
--   - `wallet_movimiento.origen_tipo        = 'ranking_snapshot_fila'`
--   - `wallet_tienda_movimiento.origen_tipo = 'ranking_snapshot_fila'`
--   - `pago_mensajero_movimiento.origen_tipo = 'ranking_snapshot_fila'`
-- Postgres no soporta `DROP VALUE` de un enum, asi que los tipos se RECREAN sin los valores
-- nuevos; si existiera una fila con alguno, el `USING ('...'::text::"<tipo>")` FALLA y el
-- rollback ABORTA con un error claro, sin dejar la base a medias. Es el comportamiento
-- CORRECTO: revertir con PREMIOS YA DEVENGADOS no es seguro — el reverso de un libro
-- append-only de dinero no puede ser un borrado silencioso.
--
-- ⚠️ LAS TRES TABLAS, NO UNA. `wallet_origen_tipo` lo usan `wallet_movimiento` (42),
-- `wallet_tienda_movimiento` (43) y `pago_mensajero_movimiento` (44). Olvidar cualquiera deja el
-- tipo `wallet_origen_tipo_old` con una columna dependiente y el `DROP TYPE` falla, ABORTANDO EL
-- ROLLBACK A MITAD (esta escrito en `20260730130000_orden_incidente/down.sql:13-18`). Por eso se
-- sueltan y recrean los SEIS indices que referencian `origen_tipo` —dos por tabla—, con el mismo
-- nombre y la misma forma.
--
-- NINGUN `down.sql` PREVIO SE TOCA, y esta verificado, no supuesto:
--   - `pago_mensajero_movimiento_categoria`: los unicos archivos que lo mencionan son la
--     migracion que lo crea (20260712180000) y su `down.sql`, que hace `DROP TYPE IF EXISTS` —no
--     recrea con lista—, asi que un valor nuevo no le afecta.
--   - `wallet_origen_tipo`: el unico down que lo RECREA con lista es el de la 158
--     (20260730130000_orden_incidente). En un rollback los downs corren del mas NUEVO al mas
--     VIEJO: cuando ese se ejecute, el valor de esta feature ya se habra retirado aqui. Son
--     fotos historicas punto-en-el-tiempo y se dejan como estan.
--
-- NO se tocan RLS ni policies (la migracion tampoco las toco). No se borra ni una fila del libro
-- (append-only, tambien al revertir).

-- 1) Los dos unicos parciales del premio y el CHECK de `premio_dia`. Van PRIMERO porque los tres
--    NOMBRAN valores del enum de categoria que se va a recrear: soltarlos despues del cast
--    dejaria expresiones ligadas al tipo viejo y el rollback abortaria a mitad.
DROP INDEX IF EXISTS "pago_mensajero_movimiento_premio_reverso_uq";
DROP INDEX IF EXISTS "pago_mensajero_movimiento_premio_dia_uq";
ALTER TABLE "pago_mensajero_movimiento" DROP CONSTRAINT IF EXISTS "pago_mensajero_movimiento_premio_dia_check";

-- 2) El CHECK tipo<->categoria, que nombra `premio_ranking`. Mismo motivo que arriba.
ALTER TABLE "pago_mensajero_movimiento" DROP CONSTRAINT IF EXISTS "pago_mensajero_movimiento_tipo_categoria_check";

-- 3) Los SEIS indices que referencian `origen_tipo`, en las TRES tablas.
DROP INDEX IF EXISTS "wallet_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_origen_uq";
DROP INDEX IF EXISTS "pago_mensajero_movimiento_origen_tipo_origen_id_idx";
DROP INDEX IF EXISTS "pago_mensajero_movimiento_origen_uq";

-- 4) `wallet_origen_tipo` vuelve a sus 7 valores previos. Ninguna de las tres columnas
--    `origen_tipo` tiene DEFAULT (no hace falta DROP DEFAULT).
ALTER TYPE "wallet_origen_tipo" RENAME TO "wallet_origen_tipo_old";
CREATE TYPE "wallet_origen_tipo" AS ENUM (
  'cierre_dia',
  'gestion_orden',
  'manual',
  'pago_tienda',
  'pago_mensajero',
  'gasto',
  'orden_incidente'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
ALTER TABLE "wallet_tienda_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
ALTER TABLE "pago_mensajero_movimiento" ALTER COLUMN "origen_tipo"
  TYPE "wallet_origen_tipo" USING ("origen_tipo"::text::"wallet_origen_tipo");
DROP TYPE "wallet_origen_tipo_old";

-- 5) La columna, ANTES de recrear el enum de categoria: asi no queda nada que la referencie.
ALTER TABLE "pago_mensajero_movimiento" DROP COLUMN IF EXISTS "premio_dia";

-- 6) `pago_mensajero_movimiento_categoria` vuelve a sus 5 valores previos. La columna
--    `categoria` no tiene DEFAULT.
ALTER TYPE "pago_mensajero_movimiento_categoria" RENAME TO "pago_mensajero_movimiento_categoria_old";
CREATE TYPE "pago_mensajero_movimiento_categoria" AS ENUM (
  'pago_devengado',
  'pago_efectivo',
  'liquidacion',
  'ajuste_devengo',
  'ajuste_pago'
);
ALTER TABLE "pago_mensajero_movimiento" ALTER COLUMN "categoria"
  TYPE "pago_mensajero_movimiento_categoria" USING ("categoria"::text::"pago_mensajero_movimiento_categoria");
DROP TYPE "pago_mensajero_movimiento_categoria_old";

-- 7) Los seis indices, tal cual estaban en las migraciones de 42/43/44 —mismos nombres, misma
--    forma, mismos predicados parciales—, incluido `pago_mensajero_movimiento_origen_uq` con su
--    PREDICADO ORIGINAL (`WHERE origen_id IS NOT NULL`, sin la exclusion de categorias).
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

-- 8) Y el CHECK tipo<->categoria vuelve con su LISTA ORIGINAL de cinco (la de la 172).
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'devengo' AND "categoria" IN ('pago_devengado','ajuste_devengo'))
  OR
  ("tipo" = 'pago' AND "categoria" IN ('pago_efectivo','liquidacion','ajuste_pago'))
);
