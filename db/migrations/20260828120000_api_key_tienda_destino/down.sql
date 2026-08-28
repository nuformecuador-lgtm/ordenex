-- DOWN (feature 302) — revierte EXACTAMENTE migration.sql: quita el indice, la FK y la columna.
--
-- QUIEN REVIERTA ESTO DEBE REVERTIR TAMBIEN EL CODIGO. Con la columna fuera y el codigo nuevo
-- puesto, `findByKeyHash` pediria a Postgres una columna que ya no existe y TODO el canal por API
-- key caeria con un 500 (no con un 403): no es una degradacion elegante, es una caida.
--
-- ⚠️ EL DATO SE PIERDE, y hay que saberlo antes de lanzarlo. `DROP COLUMN` borra a que tienda
-- apuntaba cada key. Tras el rollback, TODA key vuelve a ser duena de sus propias ordenes: las
-- que ya creo a nombre de una tienda real SIGUEN siendo de esa tienda (la FK vive en `orden`, no
-- aqui), pero las que cree a partir de entonces naceran a nombre de su cuenta dedicada — es
-- decir, vuelve el reparto en dos duenos que la ficha 302 vino a cerrar. Para saber que se
-- perderia, ANTES de lanzarlo:
--
--   SELECT id, identificador, tienda_destino_id FROM api_key WHERE tienda_destino_id IS NOT NULL;
--
-- El orden es el inverso del UP. El `DROP COLUMN` arrastraria por si solo el indice y la FK; se
-- nombran igualmente para que el DOWN diga en voz alta todo lo que deshace.
DROP INDEX IF EXISTS "api_key_tienda_destino_id_idx";

ALTER TABLE "api_key" DROP CONSTRAINT IF EXISTS "api_key_tienda_destino_id_fkey";

ALTER TABLE "api_key" DROP COLUMN IF EXISTS "tienda_destino_id";
