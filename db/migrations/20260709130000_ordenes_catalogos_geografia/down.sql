-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- Orden inverso de dependencia (hijo antes que padre). NO toca tablas
-- preexistentes ("usuario", "rol", etc.); solo elimina lo que esta migracion creo.

DROP TABLE IF EXISTS "distrito";
DROP TABLE IF EXISTS "canton";
DROP TABLE IF EXISTS "provincia";
DROP TABLE IF EXISTS "zona";
DROP TABLE IF EXISTS "order_status";
