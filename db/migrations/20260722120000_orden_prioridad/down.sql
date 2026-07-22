-- DOWN (R12): revierte EXACTAMENTE migration.sql de esta carpeta.
-- No toca RLS ni columnas preexistentes fuera de la agregada por el UP.

ALTER TABLE "orden" DROP COLUMN IF EXISTS "prioridad";
