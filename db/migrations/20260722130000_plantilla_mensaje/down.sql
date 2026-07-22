-- DOWN (R31): revierte EXACTAMENTE migration.sql. `DROP TABLE` arrastra la PK, el
-- indice unico (`plantilla_mensaje_nombre_key`), los tres indices normales
-- (`_created_at_idx`, `_estado_idx`, `_deleted_at_idx`), la FK a usuario y la RLS.
DROP TABLE IF EXISTS "plantilla_mensaje";

-- El enum se retira despues de la tabla (ninguna columna lo referencia ya).
DROP TYPE IF EXISTS "plantilla_estado";
