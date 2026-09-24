-- DOWN de M2 (ficha 455, design §3.1; R17): el mismo `RENAME VALUE`, al reves. SIN `CREATE TYPE ... AS
-- ENUM (lista)` y sin `DROP TYPE`: el tipo, su OID y cualquier valor anadido despues sobreviven.
-- Idempotente: solo renombra si la etiqueta vigente existe. UN SOLO BLOQUE `DO`.
--
-- Encadenado historico (declarado, design §3.1): el `down.sql` de `20260730120000_incidente_indemnizacion`
-- recrea `gestion_resultado` con los codigos ANTERIORES; un rollback que saltara ESTE down y llegara a
-- aquel fallaria con error de conversion (ruidoso, no mudo). Los down previos no se editan.

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
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'gestion_resultado' AND e.enumlabel = v_par."vigente"
    ) THEN
      EXECUTE format('ALTER TYPE "gestion_resultado" RENAME VALUE %L TO %L', v_par."vigente", v_par."anterior");
    END IF;
  END LOOP;
END $$;
