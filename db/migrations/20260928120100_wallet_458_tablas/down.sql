-- DOWN (ficha 458-B, 2 de 2) — revierte `migration.sql`:
--   1. los dos CHECK tipo<->categoria vuelven a su lista PREVIA (la de la 457; van PRIMERO: nombran
--      valores que el `down` de la migracion 1, que corre despues, retira del enum);
--   2. `DROP TABLE` de `wallet_comprobante`, `rechazo_tienda_cobro_anulacion` y `wallet_anotacion`
--      (sus indices, FK, CHECK y RLS se van con ellas).
--
-- PRECONDICION RUIDOSA (R92): si alguna de las tres tablas tiene filas, o algun movimiento de la caja
-- o de una tienda usa una categoria de esta ficha, se ABORTA sin borrar nada. Una anulacion es dinero
-- devuelto, un comprobante es la prueba de un pago y una anotacion es a quien se le pago: un rollback
-- no es la forma de borrarlos. (Sin esta guardia, el paso 1 ya fallaria con 23514 al re-validar el
-- CHECK, pero el mensaje no diria por que, y el `DROP TABLE` del paso 2 SI se llevaria las filas.)
--
-- `ajuste_caja_anulacion` (461) NO es de esta ficha y no se toca, aunque desde la 458 tambien guarde
-- la constancia de la anulacion de egresos (D13): esas filas las protege el `down` de la 461.

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM "wallet_anotacion")
       + (SELECT count(*) FROM "rechazo_tienda_cobro_anulacion")
       + (SELECT count(*) FROM "wallet_comprobante")
       + (SELECT count(*) FROM "wallet_movimiento" WHERE "categoria"::text IN (
            'egreso_reverso_flete_devolucion','egreso_reverso_iva_flete_devolucion'))
       + (SELECT count(*) FROM "wallet_tienda_movimiento" WHERE "categoria"::text IN (
            'flete_devolucion_anulado','iva_flete_devolucion_anulado'))
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 458: hay % filas que usan las tablas o las categorias de la ficha 458; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

-- 1) Los CHECK, con su lista PREVIA exacta (la de `20260927120100_abono_tienda_457_tablas_y_checks`).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital',
     'ingreso_cobro_tienda',
     'ingreso_abono_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital',
     'egreso_reverso_cobro_tienda',
     'egreso_reverso_abono_tienda'))
);

ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado',
     'abono_tienda'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta',
     'abono_tienda_anulado'))
);

-- 2) Las tablas (sus indices, sus FK, sus CHECK y su RLS se van con ellas).
DROP TABLE "wallet_comprobante";
DROP TABLE "rechazo_tienda_cobro_anulacion";
DROP TABLE "wallet_anotacion";

COMMIT;
