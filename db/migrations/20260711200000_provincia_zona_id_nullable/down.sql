-- DOWN: revierte migration.sql. Volveria provincia.zona_id a NOT NULL.
-- Feature 54 (reconciliacion PR #40): la columna provincia.zona_id ya no existe
-- (eliminada en 20260711120000). No-op guardado: solo actua si la columna existe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'provincia' AND column_name = 'zona_id'
  ) THEN
    ALTER TABLE "provincia" ALTER COLUMN "zona_id" SET NOT NULL;
  END IF;
END $$;
