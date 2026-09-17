-- DOWN (ficha 431) — deshace `migration.sql` en ORDEN INVERSO: suelta los dos indices de lectura,
-- RECREA el indice unico parcial, suelta los dos CHECK y borra las cuatro columnas con su FK.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTE ROLLBACK PUEDE ABORTAR, Y ESO ES LO CORRECTO. LEE ESTO ANTES DE CORRERLO.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- (1) LA RECREACION DE `cierre_bodega_zona_solicitado_uq` FALLA SI ALGUNA ZONA TIENE DOS
--     CONSOLIDACIONES `solicitado` — que es JUSTAMENTE lo que esta ficha hace posible. No es un
--     accidente del `down`: es su precondicion. Midela antes:
--
--         SELECT zona_id, count(*) FROM cierre_bodega
--          WHERE estado = 'solicitado' GROUP BY zona_id HAVING count(*) > 1;
--
--     Si devuelve filas, el rollback ABORTA ruidosamente y hay que decidir ANTES que se hace con
--     la segunda consolidacion de cada zona: revertir con la cola partida en dos exige esa
--     decision, y tomarla en silencio seria peor. NO se anade un `DELETE` automatico aqui.
--
-- (2) BORRAR LAS CUATRO COLUMNAS PIERDE LA MARCA. `monto_recibido`, `conciliado_at`,
--     `conciliado_por` y la nota desaparecen sin rastro en `cierre_bodega`. Lo que SOBREVIVE es el
--     historial (`historial_accion`, tipos `cierre_bodega_conciliado` y
--     `cierre_bodega_conciliacion_revertida`), que este `down` NO toca — el suyo es el de
--     `20260919120000_historial_accion_conciliacion_bodega`, y ese aborta si quedan esas filas.
--     Correr los dos `down` en orden inverso deja, por tanto, un aviso ruidoso antes de perder
--     nada: primero salta el del enum.
--
-- (3) LOS `aprobado` SE QUEDAN `aprobado`. Este `down` NO devuelve a `solicitado` ninguna
--     consolidacion marcada: el estado es informacion previa a esta ficha y revertirlo inventaria
--     un cambio que nadie hizo. Tras el rollback, los `aprobado` vuelven a significar lo que
--     significaban antes —«la central les dio el visto bueno»— y el backfill retroactivo se
--     vuelve indistinguible de una aprobacion real, que es exactamente el estado del 2026-09-15.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas.

-- ---------------------------------------------------------------------------------------------
-- 4') Los indices de lectura se van; el freno vuelve.
-- ---------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS "cierre_bodega_conciliado_at_idx";
DROP INDEX IF EXISTS "cierre_bodega_zona_estado_idx";

-- El literal EXACTO de `20260712120000_cierre_bodega/migration.sql` (feature 40). Ver el aviso (1).
CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"
  ON "cierre_bodega"("zona_id") WHERE "estado" = 'solicitado';

-- ---------------------------------------------------------------------------------------------
-- 3') Los dos CHECK.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "cierre_bodega" DROP CONSTRAINT IF EXISTS "cierre_bodega_monto_recibido_no_negativo";
ALTER TABLE "cierre_bodega" DROP CONSTRAINT IF EXISTS "cierre_bodega_conciliacion_coherente";

-- ---------------------------------------------------------------------------------------------
-- 2') El backfill no se deshace por separado: se va con las columnas del paso 1'. Ver el aviso (2).
-- 1') La FK, su indice y las cuatro columnas.
-- ---------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS "cierre_bodega_conciliado_por_idx";
ALTER TABLE "cierre_bodega" DROP CONSTRAINT IF EXISTS "cierre_bodega_conciliado_por_fkey";

ALTER TABLE "cierre_bodega"
  DROP COLUMN IF EXISTS "conciliado_nota",
  DROP COLUMN IF EXISTS "monto_recibido",
  DROP COLUMN IF EXISTS "conciliado_por",
  DROP COLUMN IF EXISTS "conciliado_at";
