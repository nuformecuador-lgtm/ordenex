-- ⭑ FICHA 431 (T5) — LA MARCA DE CONCILIACION DE LA CONSOLIDACION DE BODEGA, Y EL FRENO QUE CAE.
--
-- QUE HACE ESTA MIGRACION, EN CUATRO PASOS Y EN ESTE ORDEN, QUE NO ES CASUAL:
--   1) las CUATRO columnas de la marca + su FK (aditivas y nulables: no reescriben ninguna fila);
--   2) el BACKFILL de los historicos (R30) — ANTES de los CHECK, para que los CHECK lo validen;
--   3) los DOS CHECK de coherencia y de no-negatividad (R15);
--   4) fuera el indice UNICO PARCIAL `cierre_bodega_zona_solicitado_uq`; dentro los dos de lectura.
--
-- ⚠️ EL PASO 4 ES EL CORAZON DE LA FICHA. `cierre_bodega_zona_solicitado_uq` (feature 40) es
-- `UNIQUE (zona_id) WHERE estado='solicitado'`: UNA sola consolidacion pendiente por zona. Con la
-- aprobacion como puerta eso duraba 34 minutos de mediana. Con la marca de conciliacion —que ocurre
-- cuando el efectivo llega FISICAMENTE, no cuando alguien mira la pantalla— ese indice seria EL
-- MISMO BLOQUEO MUDADO DE SITIO: la satelite podria asignar, pero no podria volver a consolidar
-- hasta que la central marcara. Justo lo que el titulo de la ficha dice que no puede pasar.
-- Lo que ese indice protegia de verdad —que dos envios simultaneos no partan la cola en dos— pasa
-- al TODO-O-NADA de `CierreBodegaRepository.crearCierreBodega`, que es donde vive la carrera.
--
-- ⚠️ EL ENUM `cierre_estado` NO SE TOCA (D3, restriccion dura): lo comparten `cierre_dia` y
-- `cierre_bodega`. `solicitado` se LEE «Pendiente de conciliar» y `aprobado` se LEE «Recibido»; el
-- estado no se congela ni se duplica en una columna nueva, porque siete pantallas y
-- `ConciliacionCierresAnaliticaRepository.contarCierresPorEstado` ya lo leen.
--
-- ⚠️ LO QUE LOS DOS `CHECK` COMPRAN, y por eso van en la BASE y no en el servicio (R15, «por ningun
-- camino — aplicacion, script o SQL a mano»):
--   · una consolidacion `aprobado` SIN datos de marca es imposible;
--   · datos de marca en una consolidacion que no esta `aprobado` es imposible;
--   · y de regalo, EL CAMINO VIEJO QUEDA IMPOSIBLE, no solo oculto:
--     `CierresBodegaAdminRepository.resolverCierreBodega` con `nuevoEstado:'aprobado'` pondria
--     `estado='aprobado'` sin marca y la base lo rechaza. Es mejor que borrarlo: si alguien lo
--     vuelve a montar, se entera con un error y no con una fila muda. RECHAZAR
--     (`estado='rechazado'`) sigue siendo legal para la base y sigue sin estar en ninguna pantalla.
--
-- `monto_recibido` PUEDE SUPERAR al total consolidado (llego de mas): solo se prohibe el negativo.
-- La diferencia se ensena tal cual, sin recortar a cero — mismo criterio con el que la ficha 393
-- decidio ensenar «Para la central» en negativo en vez de maquillarlo.
--
-- RLS: `cierre_bodega` esta con RLS habilitada y CERO policies desde la feature 40 (solo service
-- role). Anadir columnas, constraints e indices no la afecta y aqui no se toca.

-- ---------------------------------------------------------------------------------------------
-- 1) LAS CUATRO COLUMNAS. Nulables: ninguna fila se reescribe al anadirlas.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "cierre_bodega"
  ADD COLUMN "conciliado_at"   TIMESTAMP(3),
  ADD COLUMN "conciliado_por"  TEXT,
  ADD COLUMN "monto_recibido"  DECIMAL(12,2),
  ADD COLUMN "conciliado_nota" TEXT;

-- `ON DELETE RESTRICT`: quien afirmo que el dinero llego no se puede borrar dejando la afirmacion
-- huerfana. Mismo criterio que `cierre_bodega_resuelto_por_fkey`.
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_conciliado_por_fkey"
  FOREIGN KEY ("conciliado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "cierre_bodega_conciliado_por_idx" ON "cierre_bodega"("conciliado_por");

-- ---------------------------------------------------------------------------------------------
-- 2) EL BACKFILL (R30) — los historicos SE DAN POR RECIBIDOS, con su fecha original.
-- ---------------------------------------------------------------------------------------------
--
-- DECISION DEL HUMANO (Q1, 2026-09-16). Medido en produccion el 2026-09-15: 32 consolidaciones,
-- TODAS aprobadas, 5 satelites, ₡4.196.897 de `total_general` — de los cuales ₡3.091.107 son
-- efectivo y ₡1.105.790 SINPE. Se aprobaron en dos semanas de operacion normal, con cero rechazos,
-- y el dinero fluyo. Marcarlas como pendientes ensenaria el primer dia una deuda que nadie reconoce
-- y la pantalla naceria desacreditada.
--
-- ⚠️ `monto_recibido = total_efectivo` Y NO `total_general`, Y ESTO ES LO QUE HACE QUE EL SALDO
-- ARRANQUE EN CERO. El saldo sin conciliar de la ficha mide EFECTIVO —lo que viaja en el bulto—,
-- no el consolidado: el SINPE (26,3 % del total, medido) entra directo a una cuenta y no lo lleva
-- nadie en la mano. Si aqui se escribiera `total_general`, la resta `total_efectivo - monto_recibido`
-- daria NEGATIVO por el importe del SINPE y la pantalla arrancaria debiendole dinero a las
-- satelites. Con `total_efectivo`, arranca en ₡0,00, que es lo que Q1 decidio.
--
-- ⚠️ FECHA ORIGINAL, NO `now()`. Si se pusiera la de la migracion, la antiguedad de R21 arrancaria
-- falseada y el historial diria que 32 consolidaciones se recibieron el mismo segundo.
--
-- ⚠️ LA NOTA ES VISIBLE Y LO DICE. No es un backfill mudo: cada fila ensena en pantalla por que
-- esta marcada. Quien mire la del 2026-09-01 sabra que nadie conto ese dinero hoy. Lo que esta
-- afirmacion da por cierto —que ese dinero llego— NO SE MIDIO: la aprobacion de nivel 2 nunca
-- registro la llegada fisica. Esta escrito en `requirements.md` Q1 y lo firmo el humano.
--
-- ⚠️ `updated_at` NO SE TOCA. Es `@updatedAt` de Prisma (aplicacion), no un trigger de Postgres:
-- un `UPDATE` en SQL crudo lo deja intacto. Que siga igual que antes es la prueba MEDIBLE de que
-- este backfill no modifico nada mas (R30).
UPDATE "cierre_bodega"
   SET "conciliado_at"   = "resuelto_at",
       "conciliado_por"  = "resuelto_por",
       "monto_recibido"  = "total_efectivo",
       "conciliado_nota" = 'Conciliación retroactiva (ficha 431): aprobado bajo el régimen anterior, sin verificación del efectivo recibido.'
 WHERE "estado" = 'aprobado' AND "conciliado_at" IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 3) LOS DOS `CHECK`. Van DESPUES del backfill, y por eso lo VALIDAN: si el paso 2 dejara una sola
--    fila `aprobado` sin marcar, esta migracion NO TERMINA.
-- ---------------------------------------------------------------------------------------------
--
-- ⚠️ UN `aprobado` HISTORICO CON `resuelto_por` NULL ROMPERIA AQUI, ruidosamente. Es lo correcto:
-- significaria una aprobacion sin autor, y esa fila hay que mirarla antes de darla por recibida.
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_conciliacion_coherente" CHECK (
  ("conciliado_at" IS NULL     AND "conciliado_por" IS NULL     AND "monto_recibido" IS NULL
                               AND "conciliado_nota" IS NULL    AND "estado" <> 'aprobado')
  OR
  ("conciliado_at" IS NOT NULL AND "conciliado_por" IS NOT NULL AND "monto_recibido" IS NOT NULL
                               AND "estado" = 'aprobado')
);

ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_monto_recibido_no_negativo"
  CHECK ("monto_recibido" IS NULL OR "monto_recibido" >= 0);

-- ---------------------------------------------------------------------------------------------
-- 4) FUERA EL FRENO, DENTRO LOS INDICES DE LECTURA.
-- ---------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS "cierre_bodega_zona_solicitado_uq";

-- Sirve a las DOS consultas del saldo (`SaldosSatelitesRepository`): la del dinero, que agrupa por
-- zona sobre `estado <> 'rechazado'`, y la de la cola, que ademas filtra `conciliado_at IS NULL`.
CREATE INDEX "cierre_bodega_zona_estado_idx" ON "cierre_bodega"("zona_id", "estado");
CREATE INDEX "cierre_bodega_conciliado_at_idx" ON "cierre_bodega"("conciliado_at");
