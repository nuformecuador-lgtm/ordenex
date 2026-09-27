-- FICHA 455 (design §3.1 · M3, DH; R18, R16, R19) — RETIRO CONDICIONAL de los dos huerfanos del catalogo
-- `order_status` que ningun codigo usa: el estado de fulfillment que retiro la 155 y `pendiente`.
--
-- Patron 155/454: la fila del catalogo solo se borra si NADA la referencia; si el historial la cita,
-- se CONSERVA (no se puede borrar sin mentir sobre el pasado) y sigue siendo inalcanzable desde el
-- codigo: no esta en `ORDER_STATUS_SEED`, asi que ningun filtro ni selector la ofrece.
--
-- LAS FK SE LEEN DEL CATALOGO DE POSTGRES (`pg_constraint`), no se escriben a mano: hoy son 5 columnas
-- en 4 tablas (`orden.estatus_id`, `orden_historial_estado.estatus_origen_id/estatus_destino_id`,
-- `cierre_sin_gestion.estatus_origen_id`, `analytics_daily.estatus_id`; medido en local y en produccion
-- el 2026-09-24), pero una FK nueva que alguien anada antes del despliegue tambien cuenta. Con una FK
-- RESTRICT olvidada el DELETE abortaria la migracion (le paso a la 454 con `analytics_daily`).
--
-- Medido el 2026-09-24 (`progress/medicion_455.md`): en PRODUCCION 0 filas los referencian -> se
-- borran; en la base local el historial los cita (47 filas) -> se conservan.
--
-- IDEMPOTENTE (R16): una segunda pasada no encuentra la fila (o la sigue viendo referenciada).
-- SIN webhooks, notificaciones, jobs ni historial (R19). UN SOLO BLOQUE `DO`.
-- EL TIMESTAMP SE ESCRIBE A MANO (P3006). JAMAS RENUMERAR.

DO $$
DECLARE
  v_valor      text;
  v_id         text;
  v_fk         record;
  v_referencia boolean;
BEGIN
  FOREACH v_valor IN ARRAY ARRAY['en_fulfillment', 'pendiente'] LOOP
    SELECT "id" INTO v_id FROM "order_status" WHERE "value" = v_valor;
    CONTINUE WHEN v_id IS NULL;

    v_referencia := false;
    FOR v_fk IN
      SELECT c.conrelid::regclass AS tabla, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = '"order_status"'::regclass
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tabla, v_fk.columna)
        INTO v_referencia USING v_id;
      EXIT WHEN v_referencia;
    END LOOP;

    IF NOT v_referencia THEN
      DELETE FROM "order_status" WHERE "id" = v_id;
    END IF;
  END LOOP;
END $$;
