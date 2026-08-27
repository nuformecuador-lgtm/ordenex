-- Revierte la marca de MENSAJE DE BIENVENIDA.
--
-- POR QUE ESTE ARCHIVO EXISTE Y NO ES OPCIONAL: `db-rollback.ts` revierte SIEMPRE la ultima
-- carpeta y ABORTA (exit 1) si le falta su `down.sql`. Una carpeta sin down bloquea el rollback
-- de TODAS las migraciones anteriores, no solo el de la suya; por eso hay un test que lo vigila
-- (`orden-mensajero-meta-drop-nota-migration`) y por eso esto se anade ahora.
--
-- El indice se suelta ANTES que la columna solo por claridad: `DROP COLUMN` lo arrastraria de
-- todas formas, pero dejarlo explicito hace legible que esta migracion creo dos objetos.
--
-- LO QUE SE PIERDE, DECLARADO: que plantilla estaba marcada como bienvenida. Es un unico
-- booleano y se vuelve a marcar con un clic; no hay nada que archivar.
DROP INDEX IF EXISTS "plantilla_mensaje_welcome_message_key";

ALTER TABLE "plantilla_mensaje" DROP COLUMN IF EXISTS "welcome_message";
