-- DOWN — deshace la RECONCILIACION: suelta el unico `(zona_id, tienda_id)` y repone la
-- columna `deleted_at`.
--
-- LO QUE ESTE `down` NO HACE, Y POR QUE. NO vuelve a poner `tienda_id` NOT NULL.
--   1. No siempre es posible: desde la feature 274 pueden existir filas con `tienda_id`
--      NULL (el nivel 3 de la cascada, «tarifa de esa zona para cualquier tienda»), y un
--      `SET NOT NULL` sobre ellas falla. El `down` abortaria a mitad, que es el peor sitio.
--   2. No seria correcto aunque se pudiera: la que declara esa columna OPCIONAL es la
--      `20260824140000_tarifa_zona_is_default`, y es SU `down` el que debe re-apretarla si
--      alguna vez se revierte esa decision. Este archivo solo revierte lo que este `up`
--      anadio; re-apretar aqui dejaria la base en un estado que ninguna migracion describe.
--
-- PERDIDA DE DATO DECLARADA, IRREVERSIBLE: el `up` BORRA fisicamente las tarifas que
-- estuvieran marcadas como borradas en logico. Este `down` repone la COLUMNA, no las filas
-- — no hay copia en ningun sitio de donde traerlas. La base recupera la FORMA anterior, no
-- el CONTENIDO anterior. Toda tarifa viva queda con `deleted_at` NULL, o sea «no borrada»,
-- que es exactamente lo que son.
--
-- Idempotente en las dos sentencias, por la misma razon que el `up`: no se sabe si la base
-- sobre la que corre llego aqui por la migracion original o por esta.
DROP INDEX IF EXISTS "tarifas_zona_id_tienda_id_key";

ALTER TABLE "tarifas" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
