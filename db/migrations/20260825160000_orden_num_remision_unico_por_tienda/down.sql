-- DOWN — devuelve `num_remision` a UNIQUE GLOBAL.
--
-- ESTE ROLLBACK PUEDE FALLAR, y hay que saberlo antes de lanzarlo. El `up` RELAJA la
-- constraint: mientras la version nueva estuvo en produccion, dos tiendas distintas PUDIERON
-- cargar legitimamente la misma `num_remision`. En cuanto exista un solo par asi, el
-- `CREATE UNIQUE INDEX` de abajo aborta con 23505 y el rollback se queda a medias (el indice
-- por tienda ya no se habra soltado, porque va despues; esa es la razon del orden).
--
-- Para saber si el rollback es viable ANTES de intentarlo:
--
--   SELECT num_remision, count(*) AS tiendas
--   FROM orden
--   GROUP BY num_remision
--   HAVING count(*) > 1;
--
-- Si devuelve filas, no hay forma automatica de revertir: habria que decidir a que tienda se le
-- quita su remision, y eso es una decision de negocio, no de migracion. NO se ponen aqui un
-- DELETE ni un renombrado "resolutivo": destruirian datos reales de una tienda para satisfacer
-- una constraint que ya se decidio que estaba mal.
CREATE UNIQUE INDEX "orden_num_remision_key" ON "orden"("num_remision");

DROP INDEX IF EXISTS "orden_tienda_id_num_remision_key";
