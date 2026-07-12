-- Geografia poblable sin zonas: la asignacion de zona es posterior/opcional, asi
-- que provincia.zona_id pasaria a ser NULLABLE. Permite sembrar provincia/canton/
-- distrito (seed geografico) sin depender del catalogo de zonas.
--
-- Feature 54 (reconciliacion PR #40): en el estado MERGEADO la columna
-- provincia.zona_id ya fue ELIMINADA por 20260711120000_zonas_catalogo_global_pagos
-- (decision R4: la zona deja de colgar de la provincia). Esta migracion del #40
-- quedo obsoleta/rota (ALTER sobre columna inexistente -> 42703). Se guarda para
-- ser un no-op idempotente: solo relaja NOT NULL si la columna aun existe. NO se
-- revierte el refactor; se reconcilia hacia adelante.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'provincia' AND column_name = 'zona_id'
  ) THEN
    ALTER TABLE "provincia" ALTER COLUMN "zona_id" DROP NOT NULL;
  END IF;
END $$;
