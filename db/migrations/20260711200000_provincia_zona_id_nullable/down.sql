-- DOWN: revierte migration.sql. Vuelve provincia.zona_id a NOT NULL.
-- OJO: fallara si existen provincias con zona_id NULL (habria que asignarles
-- una zona antes de revertir).
ALTER TABLE "provincia" ALTER COLUMN "zona_id" SET NOT NULL;
