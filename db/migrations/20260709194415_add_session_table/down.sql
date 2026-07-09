-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- Solo elimina la tabla "Session" creada en el up. La constraint del PK
-- ("Session_pkey") cae junto con la tabla.

DROP TABLE IF EXISTS "Session";
