-- DOWN (ficha 461, 3 de 3) — reverso del backfill (R36).
--
-- Borra EXACTAMENTE las lineas que escribio `migration.sql`: origen `cobro_tienda_completado` y
-- categoria `ingreso_cobro_tienda`. Ninguna otra fila: las que escribe el SERVICIO llevan origen
-- `cobro_tienda` y no se tocan (por eso son dos origenes, P2). Es la segunda excepcion a «el libro de
-- la caja no se borra» (la primera es la reclasificacion de la 459), y existe solo como reverso de
-- esta migracion.
--
-- PRECONDICION RUIDOSA: si alguna linea completada ya tiene su REVERSO de anulacion (un
-- `egreso_reverso_cobro_tienda` con el mismo `origen_id`), se ABORTA sin borrar nada: borrar el
-- original dejaria el reverso huerfano y romperia R8 («De las tiendas» ≠ Σ saldos).

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
  FROM wallet_movimiento w
  WHERE w.origen_tipo::text = 'cobro_tienda_completado'
    AND w.categoria::text = 'ingreso_cobro_tienda'
    AND EXISTS (
      SELECT 1 FROM wallet_movimiento r
      WHERE r.origen_id = w.origen_id
        AND r.categoria::text = 'egreso_reverso_cobro_tienda'
    );
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 461: % lineas completadas ya tienen su reverso de anulacion; se aborta sin borrar nada', v_n;
  END IF;
END
$$;

DELETE FROM wallet_movimiento
WHERE origen_tipo::text = 'cobro_tienda_completado'
  AND categoria::text = 'ingreso_cobro_tienda';

COMMIT;
