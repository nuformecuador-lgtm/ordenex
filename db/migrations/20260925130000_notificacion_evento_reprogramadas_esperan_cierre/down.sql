-- DOWN (ficha 462, T2.1) — quita los DOS valores de enum que añadio `migration.sql`:
--   notificacion_evento        − reprogramadas_esperan_cierre
--   notificacion_entidad_tipo  − reprogramadas_esperan_cierre_dia
--
-- ⚠️ NO RECREA EL TIPO CON UNA LISTA FIJA (decision del leader del 2026-09-25, precedente P12 de la
-- ficha 459). Hasta la 427, los `down.sql` de estos dos enums recreaban el tipo con la FOTO de
-- `origin/dev` al abrir el PR. Esa foto es la de UNA rama: revertirla sobre una base que avanzo
-- BORRA EN SILENCIO los valores que otra ficha añadio despues (le paso a la 401 con la 403, y esta
-- escrito en su `down.sql`; memoria «el down.sql borra los valores posteriores»). Aqui se lee la
-- lista VIGENTE de `pg_enum` y se quitan SOLO estos dos valores: vale igual en `prod`, en `dev` y en
-- cualquier clon, hoy y dentro de seis meses. Los `down.sql` PREVIOS de estos enums (146, 253, 262,
-- 271, 333, 403, 401, 409, 412, 413, 427) NO se tocan: son fotos historicas y todas siguen siendo
-- ciertas (memoria «migracion editada en sitio = drift»).
--
-- LA FUNCION ES LA MISMA QUE LA DE LA 459, byte a byte salvo el sufijo del nombre y de los
-- mensajes (`_462`): lo afirma `tests/integration/db/462/notificacion-evento-reprogramadas-migration.test.ts`
-- normalizando el sufijo. Si alguien la mejora, la mejora en las dos.
--
-- QUE HACE POR DENTRO, para los DOS tipos y para TODAS las columnas que los usan — hoy tres:
-- `notificacion.evento`, `notificacion.entidad_tipo` y `push_envio_dia.evento` (la de la 410, que
-- es la que se olvida y mata el `DROP TYPE` con `2BP01`). La funcion las DESCUBRE en `pg_attribute`
-- en vez de enumerarlas: una cuarta columna mañana entra sola.
--   1. PRECONDICION RUIDOSA: si alguna fila de cualquier columna de ese tipo usa un valor a quitar
--      (un aviso de este evento en `notificacion`, un cupo en `push_envio_dia`), RAISE y no se toca
--      NADA. Son avisos de trabajo que su destinatario puede no haber leido; AQUI NO HAY NI UN
--      `DELETE` NI UN `UPDATE` PARA HACER SITIO.
--   2. Guarda y suelta lo que NOMBRA el tipo por texto (CHECK e indices con `'x'::tipo`) y los
--      DEFAULT. Los indices que solo usan la columna —`notificacion_dedupe_key` (UNIQUE, parcial,
--      `NULLS NOT DISTINCT`) y `push_envio_dia_cupo` (UNIQUE)— los reconstruye solo el
--      `ALTER COLUMN … TYPE`, y que sobrevivan con su definicion exacta NO se supone: lo mide el test.
--   3. `RENAME` → `CREATE TYPE` con la lista vigente menos los valores → `ALTER COLUMN … USING` en
--      TODAS las columnas → `DROP` del viejo.
--   4. Restaura DEFAULT, indices y CHECK.
-- Si ninguno de los valores esta ya en el tipo, no hace nada (idempotente).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.quitar_valores_de_enum_462(p_esquema text, p_tipo text, p_quitar text[])
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_tipo_oid oid;
  v_actuales text[];
  v_quedan text[];
  v_lista text;
  v_n bigint;
  v_patron text;
  v_tablas text[] := '{}';
  v_columnas text[] := '{}';
  v_checks text[] := '{}';
  v_indices text[] := '{}';
  v_defaults text[] := '{}';
  v_sql text;
  r record;
  i int;
BEGIN
  SELECT t.oid INTO v_tipo_oid
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typname = p_tipo AND n.nspname = p_esquema;
  IF v_tipo_oid IS NULL THEN
    RAISE EXCEPTION 'rollback 462: no existe el tipo %.%', p_esquema, p_tipo;
  END IF;

  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO v_actuales
    FROM pg_enum e WHERE e.enumtypid = v_tipo_oid;
  IF NOT (v_actuales && p_quitar) THEN
    RAISE NOTICE 'rollback 462: %.% no tiene ninguno de %; nada que hacer', p_esquema, p_tipo, p_quitar;
    RETURN;
  END IF;
  SELECT array_agg(x ORDER BY o) INTO v_quedan
    FROM unnest(v_actuales) WITH ORDINALITY AS u(x, o)
   WHERE NOT (x = ANY (p_quitar));

  -- Las columnas que usan el tipo, recogidas ANTES de tocar nada.
  FOR r IN
    SELECT c.relname::text AS tabla, a.attname::text AS col
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = p_esquema AND c.relkind = 'r' AND a.attnum > 0
       AND NOT a.attisdropped AND a.atttypid = v_tipo_oid
     ORDER BY 1, 2
  LOOP
    v_tablas := v_tablas || r.tabla;
    v_columnas := v_columnas || r.col;
  END LOOP;

  -- 1) Precondicion ruidosa.
  FOR i IN 1 .. coalesce(array_length(v_tablas, 1), 0) LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text = ANY ($1)', p_esquema, v_tablas[i], v_columnas[i])
      INTO v_n USING p_quitar;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'rollback 462: % filas de %.% usan %; se aborta sin borrar nada',
        v_n, v_tablas[i], v_columnas[i], p_quitar;
    END IF;
  END LOOP;

  -- 2) Lo que nombra el tipo por texto: `::tipo`, con o sin esquema delante.
  v_patron := '::("?[A-Za-z0-9_]+"?\.)?"?' || p_tipo || '"?([^A-Za-z0-9_]|$)';
  FOR r IN
    SELECT con.conname::text AS nombre, c.relname::text AS tabla, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = p_esquema AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ~ v_patron
  LOOP
    v_checks := v_checks || format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', p_esquema, r.tabla, r.nombre, r.def);
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', p_esquema, r.tabla, r.nombre);
  END LOOP;
  FOR r IN
    SELECT ix.indexname::text AS nombre, ix.indexdef AS def
      FROM pg_indexes ix
     WHERE ix.schemaname = p_esquema AND ix.indexdef ~ v_patron
  LOOP
    v_indices := v_indices || r.def;
    EXECUTE format('DROP INDEX %I.%I', p_esquema, r.nombre);
  END LOOP;
  FOR i IN 1 .. coalesce(array_length(v_tablas, 1), 0) LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_sql
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON c.oid = d.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = p_esquema AND c.relname = v_tablas[i] AND a.attname = v_columnas[i];
    IF v_sql IS NOT NULL THEN
      v_defaults := v_defaults || format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s', p_esquema, v_tablas[i], v_columnas[i], v_sql);
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT', p_esquema, v_tablas[i], v_columnas[i]);
    END IF;
  END LOOP;

  -- 3) El tipo, recreado con la lista VIGENTE menos los valores de esta ficha.
  SELECT string_agg(quote_literal(x), ', ' ORDER BY o) INTO v_lista
    FROM unnest(v_quedan) WITH ORDINALITY AS u(x, o);
  EXECUTE format('ALTER TYPE %I.%I RENAME TO %I', p_esquema, p_tipo, p_tipo || '_old_462');
  EXECUTE format('CREATE TYPE %I.%I AS ENUM (%s)', p_esquema, p_tipo, v_lista);
  FOR i IN 1 .. coalesce(array_length(v_tablas, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE %I.%I USING (%I::text::%I.%I)',
      p_esquema, v_tablas[i], v_columnas[i], p_esquema, p_tipo, v_columnas[i], p_esquema, p_tipo);
  END LOOP;
  EXECUTE format('DROP TYPE %I.%I', p_esquema, p_tipo || '_old_462');

  -- 4) Todo vuelve, con su definicion exacta.
  FOREACH v_sql IN ARRAY v_defaults LOOP EXECUTE v_sql; END LOOP;
  FOREACH v_sql IN ARRAY v_indices LOOP EXECUTE v_sql; END LOOP;
  FOREACH v_sql IN ARRAY v_checks LOOP EXECUTE v_sql; END LOOP;
END
$fn$;

SELECT pg_temp.quitar_valores_de_enum_462('public', 'notificacion_evento', ARRAY[
  'reprogramadas_esperan_cierre'
]);
SELECT pg_temp.quitar_valores_de_enum_462('public', 'notificacion_entidad_tipo', ARRAY[
  'reprogramadas_esperan_cierre_dia'
]);

COMMIT;
