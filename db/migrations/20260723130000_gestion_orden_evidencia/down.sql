-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta (R4).
-- Suelta la tabla nueva (y con ella el backfill y sus indices/FK, que caen con la tabla).
-- NO toca gestion_orden: las columnas viejas y sus datos (incluida la portada) quedan
-- intactas, por eso revertir NO pierde la evidencia unica preexistente. Las fotos 2..N de
-- gestiones creadas tras la migracion SI se pierden: es el reverso exacto de la feature.
DROP TABLE IF EXISTS "gestion_orden_evidencia";
