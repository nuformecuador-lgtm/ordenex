-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- Orden inverso de dependencia. NO toca tablas preexistentes ("rol",
-- "usuario", etc.); solo elimina lo que esta migracion creo.

DROP TABLE IF EXISTS "rol_permiso";
DROP TABLE IF EXISTS "permiso";
