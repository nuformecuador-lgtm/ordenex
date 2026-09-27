-- DOWN (ficha 459, 3 de 3) — revierte `migration.sql`:
--   1. los dos CHECK tipo<->categoria vuelven a su lista PREVIA (van PRIMERO: nombran valores que el
--      `down` de la migracion 1, que corre despues, retira del enum);
--   2. `DROP TABLE` de las cuatro tablas (anulaciones antes que documentos, por las FK).
--
-- PRECONDICION RUIDOSA: si existe una fila en cualquiera de las cuatro tablas, o un movimiento de
-- cualquier libro con los conceptos de esta ficha, se ABORTA sin borrar nada: un pago por cuenta o
-- un saldo inicial es dinero registrado, y un rollback no es la forma de borrarlo. (Sin esta
-- guardia, el paso 1 ya fallaria con 23514 al re-validar el CHECK, pero el mensaje no diria por que.)

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM "pago_por_cuenta_tienda")
       + (SELECT count(*) FROM "pago_por_cuenta_tienda_anulacion")
       + (SELECT count(*) FROM "aporte_capital")
       + (SELECT count(*) FROM "aporte_capital_anulacion")
       + (SELECT count(*) FROM "wallet_movimiento" WHERE "categoria"::text IN (
            'egreso_pago_por_cuenta_tienda','ingreso_reverso_pago_por_cuenta_tienda',
            'ingreso_aporte_capital','egreso_reverso_aporte_capital'))
       + (SELECT count(*) FROM "wallet_tienda_movimiento" WHERE "categoria"::text IN (
            'pago_por_cuenta','pago_por_cuenta_anulado'))
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 459: hay % filas que usan el pago por cuenta o el capital; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

-- 1) Los CHECK, con su lista PREVIA exacta (medida en la base el 2026-09-24).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion'))
);

ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual'))
);

-- 2) Las cuatro tablas (sus indices, FK, CHECK y RLS se van con ellas).
DROP TABLE "pago_por_cuenta_tienda_anulacion";
DROP TABLE "pago_por_cuenta_tienda";
DROP TABLE "aporte_capital_anulacion";
DROP TABLE "aporte_capital";

COMMIT;
