-- DOWN (R6): revierte exactamente migration.sql. `DROP TABLE` arrastra la PK, el indice
-- parcial `jobs_run_after_pending_idx`, el indice unico parcial `jobs_dedupe_key_key` y la
-- configuracion de RLS. Luego se eliminan los dos enums nativos (en orden inverso a su
-- creacion; ninguna otra tabla los referencia una vez borrada `jobs`).
DROP TABLE IF EXISTS "jobs";
DROP TYPE IF EXISTS "job_estado";
DROP TYPE IF EXISTS "job_tipo";
