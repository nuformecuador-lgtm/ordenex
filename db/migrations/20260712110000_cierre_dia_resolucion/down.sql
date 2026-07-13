-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca la RLS de "cierre_dia" ni columnas preexistentes fuera de lo agregado por
-- el UP (solo suelta indice, FK y las 3 columnas nuevas).

DROP INDEX IF EXISTS "cierre_dia_resuelto_por_idx";
ALTER TABLE "cierre_dia" DROP CONSTRAINT IF EXISTS "cierre_dia_resuelto_por_fkey";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "motivo_rechazo";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "resuelto_at";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "resuelto_por";
