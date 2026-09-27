-- DOWN (ficha 457, 2 de 2) — revierte `migration.sql`:
--   1. los dos CHECK tipo<->categoria vuelven a su lista PREVIA (la de la 461; van PRIMERO: nombran
--      valores que el `down` de la migracion 1, que corre despues, retira del enum);
--   2. `DROP TABLE abono_tienda_anulacion` y `DROP TABLE abono_tienda` (sus indices, FK, CHECK y RLS se
--      van con ellas; la anulacion primero, porque su FK apunta al documento).
--
-- PRECONDICION RUIDOSA (R75): si existe un pago de una tienda a Ordenex, una anulacion, o un
-- movimiento de cualquier libro con los conceptos de esta ficha, se ABORTA sin borrar nada: un pago
-- con su credito y su entrada en la caja es dinero registrado, y un rollback no es la forma de
-- borrarlo. (Sin esta guardia, el paso 1 ya fallaria con 23514 al re-validar el CHECK, pero el mensaje
-- no diria por que, y el `DROP TABLE` del paso 2 SI se llevaria el documento.)

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM "abono_tienda")
       + (SELECT count(*) FROM "abono_tienda_anulacion")
       + (SELECT count(*) FROM "wallet_movimiento" WHERE "categoria"::text IN (
            'ingreso_abono_tienda','egreso_reverso_abono_tienda'))
       + (SELECT count(*) FROM "wallet_tienda_movimiento" WHERE "categoria"::text IN (
            'abono_tienda','abono_tienda_anulado'))
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 457: hay % filas que usan el pago de una tienda a Ordenex o su anulacion; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

-- 1) Los CHECK, con su lista PREVIA exacta (la de `20260926120100_cobro_tienda_461_anulacion_y_checks`).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital',
     'ingreso_cobro_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital',
     'egreso_reverso_cobro_tienda'))
);

ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta'))
);

-- 2) Las tablas (sus indices, sus FK, sus CHECK y su RLS se van con ellas). La anulacion primero.
DROP TABLE "abono_tienda_anulacion";
DROP TABLE "abono_tienda";

COMMIT;
