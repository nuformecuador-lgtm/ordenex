-- FICHA 461 (3 de 3) — COMPLETAR LA LINEA DE CAJA DE LOS COBROS PREVIOS (R31–R35, design §3.3).
--
-- QUE HACE: por cada cobro de Ordenex a una tienda (`debito/cobro_manual`) registrado ANTES de esta
-- ficha —cuando el servicio escribia solo el debito de la tienda—, UNA linea de caja
-- `ingreso/ingreso_cobro_tienda` por el MISMO monto, con el MISMO instante (`fecha_movimiento`) y la
-- MISMA persona (`registrado_por`), con origen `cobro_tienda_completado` → id del cobro. Es lo que la
-- app debio escribir (HD1): la ganancia sube en la suma y «De las tiendas» baja lo mismo; la cifra
-- principal, «Entró» y «Salió» no cambian. No modifica ni borra NINGUNA otra fila (R31).
--
-- QUIEN ES CANDIDATO (R32): un cobro que NO fue reclasificado por la 459 (no tiene salida
-- `cobro_manual_reclasificado`: su dinero nunca fue ganancia y ya esta en la caja como pago de un
-- gasto) y que NO tiene ya su linea de cobro con ninguno de los dos origenes (`cobro_tienda` la del
-- servicio nuevo, `cobro_tienda_completado` la de una pasada anterior de esta migracion).
--
-- SIN LISTA: el criterio es por DATOS, no por ids (design §12). En produccion se espera 0 candidatos
-- (los 203 estan reclasificados); en local y preview hay algunos, y en los tres casos la migracion
-- escribe EXACTAMENTE los que cumplen el criterio y dice cuantos.
--
-- IDEMPOTENTE (R33): `ON CONFLICT` sobre `wallet_movimiento_origen_categoria_uq`; aplicada dos veces
-- deja una sola linea por cobro. Al final se cuentan y suman las lineas de los candidatos: si no son
-- las esperadas, falla y no queda nada escrito (R34). Todo va en UN solo bloque `DO`.
-- SIN CANDIDATOS (R35): `RAISE NOTICE` y `RETURN` sin escribir.
--
-- SIN HISTORIAL: una migracion no tiene actor. El rastro es el origen `cobro_tienda_completado`, el
-- `NOTICE` con numero y suma (el leader lo copia a `progress/contraste_461.md`) y esta cabecera.
DO $$
DECLARE
  n_candidatos integer;
  suma_candidatos numeric(14,2);
  n_escritas integer;
  suma_escrita numeric(14,2);
BEGIN
  DROP TABLE IF EXISTS pg_temp.candidatos_461;
  CREATE TEMP TABLE candidatos_461 ON COMMIT DROP AS
  SELECT m.id, m.tienda_id, m.monto, m.descripcion, m.registrado_por, m.fecha_movimiento
  FROM wallet_tienda_movimiento m
  WHERE m.categoria::text = 'cobro_manual'
    AND m.tipo::text = 'debito'
    -- R32: ni los reclasificados por la 459…
    AND NOT EXISTS (
      SELECT 1 FROM wallet_movimiento w
      WHERE w.origen_id = m.id AND w.origen_tipo::text = 'cobro_manual_reclasificado'
    )
    -- …ni los que ya tienen su cargo, con cualquiera de los dos origenes.
    AND NOT EXISTS (
      SELECT 1 FROM wallet_movimiento w
      WHERE w.origen_id = m.id AND w.categoria::text = 'ingreso_cobro_tienda'
    );

  SELECT count(*), COALESCE(sum(monto), 0) INTO n_candidatos, suma_candidatos FROM candidatos_461;
  IF n_candidatos = 0 THEN
    RAISE NOTICE 'completar caja 461: ningun cobro sin linea de caja; no se escribe nada';       -- R35
    RETURN;
  END IF;

  INSERT INTO wallet_movimiento
    (id, tipo, categoria, monto, origen_tipo, origen_id, descripcion, registrado_por, fecha_movimiento, created_at)
  SELECT gen_random_uuid()::text,
         'ingreso',
         'ingreso_cobro_tienda',
         c.monto,
         'cobro_tienda_completado',
         c.id,
         -- «{Tienda} · {descripcion del cobro}»: el nombre como lo compone el resto de la caja
         -- (nombre + primer apellido, `etiquetaDePersona`), sin ningun id (R31/R7).
         concat_ws(' · ', NULLIF(btrim(concat_ws(' ', u.nombre, u.primer_apellido)), ''), c.descripcion),
         c.registrado_por,                                                                  -- la persona que registro el cobro
         c.fecha_movimiento,                                                                -- R31: el MISMO instante
         CURRENT_TIMESTAMP
  FROM candidatos_461 c
  JOIN usuario u ON u.id = c.tienda_id
  ON CONFLICT ("origen_tipo", "origen_id", "categoria") WHERE "origen_id" IS NOT NULL DO NOTHING;  -- R33

  SELECT count(*), COALESCE(sum(w.monto), 0) INTO n_escritas, suma_escrita
  FROM wallet_movimiento w JOIN candidatos_461 c ON c.id = w.origen_id
  WHERE w.origen_tipo::text = 'cobro_tienda_completado'
    AND w.categoria::text = 'ingreso_cobro_tienda';
  IF n_escritas <> n_candidatos OR suma_escrita <> suma_candidatos THEN
    RAISE EXCEPTION 'completar caja 461: escritas % por %, candidatos % por %',
      n_escritas, suma_escrita, n_candidatos, suma_candidatos;                              -- R34
  END IF;
  RAISE NOTICE 'completar caja 461: % cobros completados en la caja por %', n_escritas, suma_escrita;
END $$;
