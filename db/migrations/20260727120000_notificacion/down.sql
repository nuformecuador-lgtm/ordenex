-- DOWN (R8): revierte EXACTAMENTE migration.sql. Orden inverso por las FKs: primero
-- `notificacion_lectura` (depende de notificacion y de usuario), luego `notificacion`.
-- `DROP TABLE` arrastra la PK, los CHECK (XOR de destinatario, marca presente), los
-- indices (los 5 parciales de listado/alcance, el de entidad, el unico de dedupe y el
-- unico de (notificacion, usuario)), las FKs a usuario/zona y la RLS.
-- Migracion puramente ADITIVA (R7): el down NO toca ninguna tabla preexistente.
DROP TABLE IF EXISTS "notificacion_lectura";
DROP TABLE IF EXISTS "notificacion";

-- Los enums se retiran despues de las tablas (ninguna columna los referencia ya).
DROP TYPE IF EXISTS "notificacion_entidad_tipo";
DROP TYPE IF EXISTS "notificacion_evento";
DROP TYPE IF EXISTS "notificacion_tipo";
