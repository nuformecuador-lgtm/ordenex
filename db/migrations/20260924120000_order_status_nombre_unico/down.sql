-- DOWN de M1 (ficha 455, design §3.1; R17): devuelve los 7 codigos anteriores SOBRE LAS MISMAS FILAS
-- (mismo `id`, mismas FK). Los 7 `UPDATE` inversos del up, por igualdad exacta. Idempotente.
-- Mismo guardia que el up, al reves: si conviven el vigente y el anterior, falla sin tocar nada.
-- UN SOLO BLOQUE `DO`.

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
    RAISE EXCEPTION 'down 455: el catalogo tiene a la vez el codigo anterior y el vigente:%', v_choques;
  END IF;

  UPDATE "order_status" SET "value" = 'entregada'     WHERE "value" = 'entregado';
  UPDATE "order_status" SET "value" = 'devuelta'      WHERE "value" = 'novedad';
  UPDATE "order_status" SET "value" = 'reprogramada'  WHERE "value" = 'reprogramado';
  UPDATE "order_status" SET "value" = 'por_recoger'   WHERE "value" = 'mensajero_recogiendo_en_bodega';
  UPDATE "order_status" SET "value" = 'rechazada'     WHERE "value" = 'devolucion_a_origen_por_rechazo';
  UPDATE "order_status" SET "value" = 'sin_gestionar' WHERE "value" = 'novedad_interna';
  UPDATE "order_status" SET "value" = 'por_devolver'  WHERE "value" = 'por_devolver_a_bodega_central';
END $$;
