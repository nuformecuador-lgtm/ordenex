-- DOWN (R4): revierte EXACTAMENTE migration.sql. `DROP TABLE` arrastra la PK, el indice
-- unico (`orden_mensajero_meta_usuario_id_orden_id_key`), los dos indices normales
-- (`_usuario_id_idx`, `_orden_id_idx`), las dos FK a usuario/orden y la RLS.
DROP TABLE IF EXISTS "orden_mensajero_meta";
