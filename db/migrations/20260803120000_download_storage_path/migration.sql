-- Feature 177 (T4, R36/R39, design §2.3) — RUTA del objeto del PDF de etiquetas.
--
-- POR QUE UNA COLUMNA NUEVA Y NO REUSAR `download_url`: lo que hoy se persiste en
-- `download_url` (features 136/141) es una URL FIRMADA, que caduca. Con solo ese dato es
-- IMPOSIBLE distinguir "el PDF existe en Storage" de "el PDF existe pero la URL murio", y
-- `IFileStorage` no tiene operacion de existencia para preguntarlo. La ruta del objeto, en
-- cambio, no caduca: `download_storage_path IS NOT NULL` <=> hay PDF => solo re-firmar.
--
-- ADITIVA y NULLABLE: no hay backfill (las filas heredadas de la 136/141 quedan en NULL y se
-- tratan como "sin PDF", R38: la primera llamada a /generate regenera). `download_url` NO se
-- toca en esta migracion: ni se lee, ni se escribe, ni se borra (R26/R35/R38).
--
-- SIN INDICE: esta columna nunca aparece en un WHERE. Se lee siempre por PK/owner ya
-- resueltos (`orden.id` + `tienda_id`, `carga.id` + `usuario_carga`), asi que un indice solo
-- costaria escrituras.
--
-- SIN RLS nueva: no hay tablas nuevas. `orden` y `carga` conservan su politica actual.
ALTER TABLE "orden" ADD COLUMN "download_storage_path" TEXT;
ALTER TABLE "carga" ADD COLUMN "download_storage_path" TEXT;
