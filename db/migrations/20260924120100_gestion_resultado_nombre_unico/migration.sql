-- FICHA 455 (design §3.1 · M2; R15, R16, R19) — el resultado de una gestion se llama igual que su
-- estado destino (design DC): renombre de 4 etiquetas del enum `gestion_resultado`.
--
--   entregada    -> entregado
--   reprogramada -> reprogramado
--   devuelta     -> novedad
--   rechazada    -> devolucion_a_origen_por_rechazo
--   (incidente no cambia)
--
-- `ALTER TYPE ... RENAME VALUE` cambia la etiqueta en `pg_enum` y conserva el OID del valor: NINGUNA fila
-- de `gestion_orden` ni de `orden_evento` (resultado / resultado_anterior) se reescribe, el conteo no
-- cambia y el orden de las etiquetas se conserva. No hay CHECK, indice parcial, vista, funcion ni
-- trigger que cite estos valores (medido en la base: pg_constraint, pg_index, pg_proc, pg_views).
--
-- NO se recrea el tipo con lista (lo que propone `prisma migrate diff`): recrear con lista es una foto
-- de esta rama y, revertido sobre una base que avanzo, borraria en silencio los valores posteriores.
--
-- ACOTADO AL ESQUEMA de la migracion (`current_schema()`): `pg_enum`/`pg_type` son globales a la base y
-- la suite crea esquemas temporales con el mismo tipo; sin el `JOIN pg_namespace` el `IF EXISTS` podria
-- ver la etiqueta de OTRO esquema (patron `SQL_ETIQUETAS_DE_ENUM`, flake del 2026-09-11).
--
-- IDEMPOTENTE (R16): cada renombre solo ocurre si la etiqueta anterior existe; una segunda pasada no
-- hace nada. SIN webhooks, notificaciones, jobs ni historial (R19).
-- UN SOLO BLOQUE `DO`. EL TIMESTAMP SE ESCRIBE A MANO (P3006). JAMAS RENUMERAR.

DO $$
DECLARE
  v_par record;
BEGIN
  FOR v_par IN
    SELECT * FROM (VALUES
      ('entregada', 'entregado'),
      ('reprogramada', 'reprogramado'),
      ('devuelta', 'novedad'),
      ('rechazada', 'devolucion_a_origen_por_rechazo')
    ) AS t("anterior", "vigente")
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'gestion_resultado' AND n.nspname = current_schema()
         AND e.enumlabel = v_par."anterior"
    ) THEN
      EXECUTE format('ALTER TYPE %I.%I RENAME VALUE %L TO %L', current_schema(), 'gestion_resultado', v_par."anterior", v_par."vigente");
    END IF;
  END LOOP;
END $$;
