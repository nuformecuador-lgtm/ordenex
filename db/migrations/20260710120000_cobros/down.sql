-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- NO toca tablas preexistentes; solo elimina la tabla "cobro" (sin FKs, sin
-- secuencias asociadas: "id" es uuid, no SERIAL).

DROP TABLE IF EXISTS "cobro";
