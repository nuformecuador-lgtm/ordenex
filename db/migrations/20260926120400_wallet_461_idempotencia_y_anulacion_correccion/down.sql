-- DOWN (ficha 461, 5 de 6 — auditoria D2/D3) — revierte `migration.sql`:
--   1. `DROP TABLE ajuste_caja_anulacion` (su indice unico, sus FK, su CHECK y su RLS se van con ella);
--   2. los dos indices unicos y las dos columnas `clave_idempotencia`.
--
-- PRECONDICION RUIDOSA (R62): si existe UNA anulacion de correccion, o UNA fila de cualquiera de los
-- dos libros con clave de idempotencia, se ABORTA sin borrar nada. Una clave es la prueba de que un
-- registro manual no se duplico y una anulacion es dinero devuelto: un rollback no es la forma de
-- borrarlos. (Sin esta guardia, `DROP COLUMN` se llevaria las claves en silencio.)

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM "ajuste_caja_anulacion")
       + (SELECT count(*) FROM "wallet_movimiento" WHERE "clave_idempotencia" IS NOT NULL)
       + (SELECT count(*) FROM "wallet_tienda_movimiento" WHERE "clave_idempotencia" IS NOT NULL)
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 461: hay % filas que usan la anulacion de una correccion o una clave de idempotencia; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

-- 1) La tabla (su indice unico, sus FK, su CHECK y su RLS se van con ella).
DROP TABLE "ajuste_caja_anulacion";

-- 2) Los indices y las columnas de la clave.
DROP INDEX "wallet_tienda_movimiento_clave_idempotencia_key";
DROP INDEX "wallet_movimiento_clave_idempotencia_key";
ALTER TABLE "wallet_tienda_movimiento" DROP COLUMN "clave_idempotencia";
ALTER TABLE "wallet_movimiento" DROP COLUMN "clave_idempotencia";

COMMIT;
