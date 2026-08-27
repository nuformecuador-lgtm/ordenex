-- DOWN (feature 294) — devuelve `orden_tienda_id_num_remision_key` a UNIQUE **sin predicado**,
-- exactamente como lo dejo `20260825160000_orden_num_remision_unico_por_tienda`.
--
-- ⚠️ ESTE ROLLBACK PUEDE FALLAR, y hay que saberlo ANTES de lanzarlo. El `up` RELAJA la
-- constraint: mientras la version nueva estuvo desplegada, una tienda PUDO volver a usar
-- legitimamente el `num_remision` de una orden que habia borrado. En cuanto exista un solo par
-- `(tienda_id, num_remision)` repetido —una fila viva y una borrada, o dos borradas— el
-- `CREATE UNIQUE INDEX` de abajo aborta con 23505 y el rollback se queda a medias (el parcial ya
-- se habra soltado; por eso el `DROP` va primero y no hay forma de evitarlo: los dos indices
-- comparten NOMBRE).
--
-- Para saber si el rollback es viable, ANTES de intentarlo:
--
--   SELECT tienda_id, num_remision, count(*) AS filas
--   FROM orden
--   GROUP BY tienda_id, num_remision
--   HAVING count(*) > 1;
--
-- Si devuelve filas, el rollback NO es automatizable: habria que decidir a QUE orden se le
-- quita su remision, y eso es una decision de negocio. NO se pone aqui un DELETE ni un
-- renombrado "resolutivo" (el sufijo `-BORRADA-<fecha>` que se aplico a mano en produccion el
-- 2026-08-27 para desbloquear a Nuform es exactamente esa clase de parche): destruiria el dato
-- real de una tienda para satisfacer una constraint que ya se decidio que estaba mal.
--
-- QUIEN REVIERTA ESTO DEBE REVERTIR TAMBIEN EL CODIGO. Con el indice sin predicado y la
-- validacion mirando solo lo vivo, vuelve el fallo mudo de la ficha 294 — solo que ahora la
-- carga SI lo reporta (las filas saltadas salen como `duplicada` en el resumen), asi que el
-- sintoma deja de ser invisible pero la tienda sigue sin poder reusar el numero.
--
-- No toca RLS ni policies (la migracion tampoco las toco) y no mueve ninguna fila.

DROP INDEX "orden_tienda_id_num_remision_key";

CREATE UNIQUE INDEX "orden_tienda_id_num_remision_key"
  ON "orden"("tienda_id", "num_remision");
