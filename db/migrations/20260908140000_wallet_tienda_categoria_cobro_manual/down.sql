-- DOWN (ficha 381, 1 de 2) — revierte EXACTAMENTE `migration.sql`: quita el valor `cobro_manual`
-- de `wallet_tienda_movimiento_categoria`.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta `ALTER TYPE … DROP VALUE`.
-- La unica via es RECREAR el tipo con la lista PREVIA y recastear la columna que lo usa. Patron
-- IDENTICO al de `20260827120000_premio_ranking_devengo/down.sql`, que hizo exactamente esto con
-- `pago_mensajero_movimiento_categoria`.
--
-- SE COMPROBO CUAL ES LA FORMA DEL `down` DE ESTE ENUM, no se supuso: el unico archivo previo que
-- lo menciona es la migracion que lo CREA (`20260712170000_wallet_tienda_movimiento`) y su propio
-- `down.sql`, que hace `DROP TYPE` porque tambien dropea la tabla entera — asi que un valor nuevo
-- no le afecta y NO hay que tocarlo. Esta es la PRIMERA ampliacion de este enum en toda su vida.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AVISO, Y NO ES TEORICO: ESTA LISTA ES UNA FOTO DEL 2026-09-08.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Un `down.sql` de enum recrea el tipo con la lista COMPLETA, asi que ejecutarlo sobre una base
-- que ya avanzo BORRA EN SILENCIO, SIN UN SOLO ERROR, los valores que se añadieron despues de
-- escribirse este archivo. MEDIDO EN ESTE REPO EL 2026-09-07: el `down.sql` de una rama ramificada
-- antes del merge de la 376 se llevo por delante `zona_central_cambiada` de la base local; el
-- sintoma fueron 7 tests rojos en 6 archivos ajenos, y ni un mensaje de Postgres.
--
-- ANTES DE CORRER ESTE ARCHIVO, MIDE EL CATALOGO DE HOY:
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'wallet_tienda_movimiento_categoria' ORDER BY e.enumsortorder;
-- Si esa consulta devuelve algo que NO sea «los 10 de abajo mas `cobro_manual`», este `down.sql`
-- esta RANCIO y borrara lo que falte.
-- `tests/integration/db/wallet-tienda-cobro-migration.test.ts` no se fia de esta frase: reconstruye
-- el estado previo ejecutando las migraciones REALES anteriores —descubiertas leyendo
-- `db/migrations`, no escritas a mano— y COMPARA valor a valor y en orden.
--
-- DE DONDE SALE LA LISTA, sin lugar a duda: LOS 10 son los del `CREATE TYPE` de
-- `20260712170000_wallet_tienda_movimiento/migration.sql`, tal cual y en su orden. Ninguna
-- migracion los habia ampliado desde entonces. Y ademas se MIDIO contra la base local el
-- 2026-09-08 con la consulta de arriba: 10 valores, en este mismo orden.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "wallet_tienda_movimiento" con
-- `categoria = 'cobro_manual'`. Si quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE
-- al no poder castear ese valor al tipo recreado y el rollback ABORTA. Eso es lo CORRECTO: un cobro
-- es dinero que una tienda debe, y el reverso de un libro append-only de dinero no puede ser un
-- borrado silencioso. Primero se decide que hacer con esas filas.
--
-- La columna que usa este enum es exactamente una: "wallet_tienda_movimiento"."categoria".

-- 1) TODO lo que NOMBRA el tipo o depende de la columna, PRIMERO. Soltarlo despues del cast
--    dejaria expresiones ligadas al tipo viejo y el rollback abortaria a mitad.
--    · el CHECK tipo<->categoria (nombra los valores por rama);
--    · el indice (tienda_id, categoria);
--    · el UNICO PARCIAL de idempotencia, que lleva `categoria` en su clave.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT IF EXISTS "wallet_tienda_movimiento_tipo_categoria_check";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_tienda_id_categoria_idx";
DROP INDEX IF EXISTS "wallet_tienda_movimiento_origen_uq";

-- 2) El enum vuelve a sus 10 valores previos. La columna `categoria` no tiene DEFAULT.
ALTER TYPE "wallet_tienda_movimiento_categoria" RENAME TO "wallet_tienda_movimiento_categoria_old";
CREATE TYPE "wallet_tienda_movimiento_categoria" AS ENUM (
  'cod_recaudado',
  'flete',
  'flete_devolucion',
  'comision_cod',
  'iva_flete',
  'iva_flete_devolucion',
  'iva_comision_cod',
  'pago_tienda',
  'ajuste_credito',
  -- ES EL ULTIMO DE LA FOTO DEL 2026-09-08: si entre esa fecha y el dia en que se corra este
  -- `down` alguna ficha ampliara el enum, su valor NO esta en esta lista y se perderia en
  -- silencio. Ver el aviso de arriba.
  'ajuste_debito'
);
ALTER TABLE "wallet_tienda_movimiento" ALTER COLUMN "categoria"
  TYPE "wallet_tienda_movimiento_categoria" USING ("categoria"::text::"wallet_tienda_movimiento_categoria");
DROP TYPE "wallet_tienda_movimiento_categoria_old";

-- 3) Los DOS indices, con el MISMO nombre y la MISMA forma que en `20260712170000` —el parcial con
--    su `WHERE "origen_id" IS NOT NULL`, que es lo que deja a los manuales fuera de la
--    deduplicacion—.
CREATE INDEX "wallet_tienda_movimiento_tienda_id_categoria_idx"
  ON "wallet_tienda_movimiento"("tienda_id", "categoria");
CREATE UNIQUE INDEX "wallet_tienda_movimiento_origen_uq"
  ON "wallet_tienda_movimiento"("origen_tipo", "origen_id", "tienda_id", "categoria")
  WHERE "origen_id" IS NOT NULL;

-- 4) Y el CHECK tipo<->categoria vuelve con su LISTA ORIGINAL (la de
--    `20260802120000_liquidacion_pago`, sin `cobro_manual`).
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito'))
);
