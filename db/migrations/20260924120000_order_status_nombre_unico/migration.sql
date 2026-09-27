-- FICHA 455 (design §3.1 · M1; R13, R14, R16, R19) — UN SOLO NOMBRE POR ESTADO: renombre en sitio de
-- 7 values del catalogo `order_status`.
--
-- QUE HACE. `UPDATE` por igualdad EXACTA del `value` (patron 135, `20260724120000`): el `id` de cada
-- fila NO cambia, asi que toda FK (`orden.estatus_id`, las dos de `orden_historial_estado`,
-- `cierre_sin_gestion.estatus_origen_id`, `analytics_daily.estatus_id`), toda vista de filtro guardada
-- (453, guarda ids) y todo job `webhook_estado` pendiente (guarda `estatusDestinoId`) siguen apuntando
-- al mismo estado. La correspondencia es la de `CODIGO_VIGENTE_DE_ANTERIOR`
-- (`lib/types/order-status.ts`) y la tabla §0.1 del spec:
--   entregada     -> entregado
--   devuelta      -> novedad
--   reprogramada  -> reprogramado
--   por_recoger   -> mensajero_recogiendo_en_bodega
--   rechazada     -> devolucion_a_origen_por_rechazo
--   sin_gestionar -> novedad_interna
--   por_devolver  -> por_devolver_a_bodega_central
-- Ningun codigo vigente coincide con un codigo anterior: el orden de los UPDATE es indiferente.
--
-- FALLA RUIDOSAMENTE (R20) si ya existe una fila con el codigo vigente Y otra con el anterior: serian
-- dos filas para un mismo estado (la dejaria un sembrado corrido antes de migrar) y renombrar chocaria
-- con el UNIQUE de `value`. No se adivina cual conservar.
--
-- IDEMPOTENTE (R16): una segunda pasada no encuentra ningun codigo anterior y no escribe nada.
-- SIN webhooks, notificaciones, jobs ni historial (R19): SQL puro, no pasa por `appendCambioEstado`;
-- la base no tiene triggers.
--
-- UN SOLO BLOQUE `DO` (todo o nada; el test `tests/integration/db/455/migracion.test.ts` lo ejecuta tal
-- cual dentro de una transaccion revertida). EL TIMESTAMP SE ESCRIBE A MANO (P3006). JAMAS RENUMERAR.

DO $$
DECLARE
  v_par     record;
  v_choques text := '';
BEGIN
  FOR v_par IN
    SELECT * FROM (VALUES
      ('entregada', 'entregado'),
      ('devuelta', 'novedad'),
      ('reprogramada', 'reprogramado'),
      ('por_recoger', 'mensajero_recogiendo_en_bodega'),
      ('rechazada', 'devolucion_a_origen_por_rechazo'),
      ('sin_gestionar', 'novedad_interna'),
      ('por_devolver', 'por_devolver_a_bodega_central')
    ) AS t("anterior", "vigente")
  LOOP
    IF EXISTS (SELECT 1 FROM "order_status" WHERE "value" = v_par."anterior")
       AND EXISTS (SELECT 1 FROM "order_status" WHERE "value" = v_par."vigente") THEN
      v_choques := v_choques || ' ' || v_par."anterior" || '/' || v_par."vigente";
    END IF;
  END LOOP;
  IF v_choques <> '' THEN
    RAISE EXCEPTION 'migracion 455: el catalogo tiene a la vez el codigo anterior y el vigente:%', v_choques;
  END IF;

  UPDATE "order_status" SET "value" = 'entregado'                       WHERE "value" = 'entregada';
  UPDATE "order_status" SET "value" = 'novedad'                         WHERE "value" = 'devuelta';
  UPDATE "order_status" SET "value" = 'reprogramado'                    WHERE "value" = 'reprogramada';
  UPDATE "order_status" SET "value" = 'mensajero_recogiendo_en_bodega'  WHERE "value" = 'por_recoger';
  UPDATE "order_status" SET "value" = 'devolucion_a_origen_por_rechazo' WHERE "value" = 'rechazada';
  UPDATE "order_status" SET "value" = 'novedad_interna'                 WHERE "value" = 'sin_gestionar';
  UPDATE "order_status" SET "value" = 'por_devolver_a_bodega_central'   WHERE "value" = 'por_devolver';
END $$;
