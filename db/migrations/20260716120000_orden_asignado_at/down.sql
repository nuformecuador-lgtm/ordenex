-- DOWN (R24): revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- No toca RLS/columnas preexistentes fuera de lo agregado por el UP.

-- 2) indice del denominador del ranking (se suelta antes que la columna que indexa).
DROP INDEX IF EXISTS "orden_mensajero_asignado_id_asignado_at_idx";

-- 1) columna de marca de asignacion.
ALTER TABLE "orden" DROP COLUMN IF EXISTS "asignado_at";
