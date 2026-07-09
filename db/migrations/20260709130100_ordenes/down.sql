-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- NO toca tablas preexistentes ("usuario", "order_status", geografia, etc.);
-- solo elimina la tabla "orden". La secuencia "orden_num_guia_seq" (creada por
-- la columna SERIAL) cae junto con la tabla.

DROP TABLE IF EXISTS "orden";
