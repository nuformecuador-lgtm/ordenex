-- FICHA 461 (6 de 6 — hallazgos de la auditoria de la wallet, T2) — MIGRACION DE DATOS: los
-- asientos de los pagos a tienda y a mensajero (y sus anulaciones) pasan de la medianoche UTC
-- exacta al INICIO DEL DIA en Costa Rica (06:00Z), que es la convencion del resto de los libros.
--
-- POR QUE. La ficha 172 fecho estos asientos con `medianocheUtcDelDia(fecha_pago)` (00:00Z) para
-- que entraran por los dos bordes de un filtro que comparaba contra `z.coerce.date()` (tambien
-- 00:00Z). Con la 461 los filtros de los tres libros pasan a dias de Costa Rica (T1, R72), y para
-- el rollup diario y la analitica —que agrupan por `(fecha_movimiento − 6 h)::date`— un asiento a
-- las 00:00Z del dia D es del dia D−1: el pago que el libro pinta el 25 lo contaba el 24 (medido por
-- la auditoria). A las 06:00Z el asiento cae en el dia de su documento en TODOS los consumidores.
--
-- QUE TOCA (R74), y solo eso: en los tres libros, las filas con origen `pago_tienda` o
-- `pago_mensajero` cuya `fecha_movimiento` es EXACTAMENTE una medianoche UTC. Ningun monto, origen,
-- categoria ni `created_at` cambia. Los asientos de los cierres (instante real), los manuales con
-- fecha elegida (ya a 06:00Z), los pagos por cuenta, los aportes y los cobros (instante del
-- servicio) no cumplen el criterio y no se tocan.
--
-- IDEMPOTENTE: tras moverlas ya no hay filas a medianoche exacta en ese conjunto; una segunda
-- ejecucion no mueve nada. El `down` mueve −6 h exactamente ese conjunto fechado a las 06:00Z
-- (antes de esta ficha ningun asiento de esos origenes se escribio a esa hora: todos eran 00:00Z).
--
-- MEDIDO EN EL CLON `ordenex_461` (2026-09-25): 0 filas en la caja, 0 en el libro de las tiendas y 6
-- en el de los mensajeros. La consulta Q3 de la auditoria mide lo mismo en produccion antes de
-- desplegar (el coordinador reporto 0 filas afectadas hoy).

DO $$
DECLARE
  n_caja integer; n_tienda integer; n_mensajero integer;
BEGIN
  UPDATE "wallet_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" + interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento");
  GET DIAGNOSTICS n_caja = ROW_COUNT;

  UPDATE "wallet_tienda_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" + interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento");
  GET DIAGNOSTICS n_tienda = ROW_COUNT;

  UPDATE "pago_mensajero_movimiento"
     SET "fecha_movimiento" = "fecha_movimiento" + interval '6 hours'
   WHERE "origen_tipo"::text IN ('pago_tienda', 'pago_mensajero')
     AND "fecha_movimiento" = date_trunc('day', "fecha_movimiento");
  GET DIAGNOSTICS n_mensajero = ROW_COUNT;

  IF n_caja + n_tienda + n_mensajero = 0 THEN
    RAISE NOTICE 'fechas CR 461: ningun asiento de pago a medianoche UTC; no se mueve nada';
  ELSE
    RAISE NOTICE 'fechas CR 461: movidos +6h — caja %, tiendas %, mensajeros %', n_caja, n_tienda, n_mensajero;
  END IF;
END $$;
