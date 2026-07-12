-- DOWN: revierte migration.sql. Elimina la tabla puente (incluye sus FKs/indices).
DROP TABLE IF EXISTS "zona_distrito";
