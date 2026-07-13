-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- No toca RLS/columnas preexistentes fuera de lo agregado por el UP.

-- 2) indice parcial de "liberadas hoy" (se suelta antes que la columna que indexa).
DROP INDEX IF EXISTS "orden_liberada_reprogramada_at_idx";

-- 1) columna de marca de liberacion.
ALTER TABLE "orden" DROP COLUMN IF EXISTS "liberada_reprogramada_at";
