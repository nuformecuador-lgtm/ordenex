-- DOWN (ficha 461, 6 de 6 — auditoria T2) — devuelve a la medianoche UTC exacta los asientos de
-- pago a tienda y a mensajero que `migration.sql` movio a las 06:00Z. Es la convencion que el
-- codigo ANTERIOR a esta ficha espera para esas filas (`medianocheUtcDelDia`), asi que tambien se
-- devuelven los asientos que el codigo nuevo hubiera escrito a las 06:00Z tras aplicarla: al
-- revertir la ficha, el libro entero de esos origenes vuelve a hablar con la convencion vieja.
--
-- SOLO ese conjunto: origen `pago_tienda`/`pago_mensajero` y hora EXACTA 06:00:00.000Z. Un manual
-- con fecha elegida tambien esta a las 06:00Z, pero su origen es `manual`/`gasto` y no se toca. Sin
-- filas que cumplan el criterio, no hace nada.

BEGIN;

DO $$
DECLARE
  n_caja integer; n_tienda integer; n_mensajero integer;
BEGIN
  UPDATE "wallet_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" - interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento") + interval '6 hours';
  GET DIAGNOSTICS n_caja = ROW_COUNT;

  UPDATE "wallet_tienda_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" - interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento") + interval '6 hours';
  GET DIAGNOSTICS n_tienda = ROW_COUNT;

  UPDATE "pago_mensajero_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" - interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento") + interval '6 hours';
  GET DIAGNOSTICS n_mensajero = ROW_COUNT;

  RAISE NOTICE 'rollback 461 fechas CR: devueltos -6h — caja %, tiendas %, mensajeros %', n_caja, n_tienda, n_mensajero;
END $$;

COMMIT;
