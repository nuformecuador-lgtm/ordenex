-- DOWN (R39): revierte EXACTAMENTE migration.sql. Los `DROP TABLE` arrastran PKs, los
-- tres indices, las tres FKs y la configuracion de RLS (patron del down.sql de la 91).
-- El orden importa: primero el detalle (tiene FK hacia la cabecera), luego la cabecera y
-- por ultimo el tipo, que ya no tiene columnas que dependan de el.
DROP TABLE IF EXISTS "ruta_optimizada_parada";
DROP TABLE IF EXISTS "ruta_optimizada";
DROP TYPE IF EXISTS "ruta_estado";
