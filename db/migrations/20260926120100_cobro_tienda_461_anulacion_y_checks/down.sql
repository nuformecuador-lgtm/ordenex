-- DOWN (ficha 461, 2 de 3) — revierte `migration.sql`:
--   1. los dos CHECK tipo<->categoria vuelven a su lista PREVIA (la de la 459; van PRIMERO: nombran
--      valores que el `down` de la migracion 1, que corre despues, retira del enum);
--   2. `DROP TABLE cobro_tienda_anulacion` (sus indices, FK, CHECK y RLS se van con ella).
--
-- PRECONDICION RUIDOSA (R62): si existe una anulacion, o un movimiento de cualquier libro con los
-- conceptos de esta ficha, se ABORTA sin borrar nada: un cobro con su linea de caja o una anulacion
-- es dinero registrado, y un rollback no es la forma de borrarlo. (Sin esta guardia, el paso 1 ya
-- fallaria con 23514 al re-validar el CHECK, pero el mensaje no diria por que.)

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM "cobro_tienda_anulacion")
       + (SELECT count(*) FROM "wallet_movimiento" WHERE "categoria"::text IN (
            'ingreso_cobro_tienda','egreso_reverso_cobro_tienda'))
       + (SELECT count(*) FROM "wallet_tienda_movimiento" WHERE "categoria"::text IN (
            'cobro_tienda_anulado'))
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 461: hay % filas que usan el cobro a una tienda o su anulacion; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

-- 1) Los CHECK, con su lista PREVIA exacta (la de `20260925120200_pago_por_cuenta_y_capital`).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital'))
);

ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta'))
);

-- 2) La tabla (su indice unico, sus FK, su CHECK y su RLS se van con ella).
DROP TABLE "cobro_tienda_anulacion";

COMMIT;
