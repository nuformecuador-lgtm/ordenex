-- Revierte EXACTAMENTE `migration.sql`: retira la columna que aquel ALTER agrego.
--
-- OJO CON EL ORDEN: `20260818150000_orden_gestion_aprobada` RENOMBRA esta columna a
-- `gestion_aprobada`. Bajar en orden inverso (que es lo que hace `scripts/db-rollback.ts`,
-- siempre la ultima) deja primero el nombre `pre_aprobacion` de vuelta y solo entonces este
-- DROP encuentra la columna. Ejecutado fuera de ese orden, falla en vez de borrar otra cosa.
ALTER TABLE "orden" DROP COLUMN "pre_aprobacion";
