-- Feature 293 (T1.1, design §3 y §10) — EL PREMIO DEL PODIO COMO DEVENGO IMPUTADO AL CIERRE.
--
-- Que se anade y por que, en una linea cada cosa:
--   1) `premio_ranking` en el enum de categorias del libro del mensajero: el premio es un
--      DEVENGO con categoria PROPIA (decision (d) del humano). Reusar `ajuste_devengo` haria
--      imposible responder «que parte de esta cuenta es premio» sin leer descripciones a ojo.
--   2) `ranking_snapshot_fila` en `wallet_origen_tipo`: el egreso de la caja apunta A LA FILA
--      DEL PODIO, no al cierre (§3.4). Con origen `(cierre_dia, cierreId)` chocaria contra el
--      `egreso_pago_mensajero` que el feed del cierre YA escribio al aprobar, y el unico de la
--      caja —`(origen_tipo, origen_id, categoria)`, SIN mensajero— lo mandaria a
--      `ON CONFLICT DO NOTHING`: dinero fuera de la caja sin registro y sin error.
--   3) `premio_dia DATE`: la fecha calendario CR del podio (medianoche UTC, convencion del
--      repo para fecha calendario). NULL en todo lo que no es premio — que es TODO lo que
--      existe hoy, asi que la migracion es ADITIVA y SIN backfill.
--   4) El CHECK tipo<->categoria de la 172, recreado con `premio_ranking` en la rama `devengo`.
--      ES EL PASO QUE NADIE VE VENIR: ese CHECK es una disyuncion de listas CERRADAS escrita
--      para fallar cerrado («mejor que la feature que anada el concepto tenga que tocar este
--      CHECK, a que su primera fila caiga en la cubeta equivocada»,
--      `20260802120000_liquidacion_pago/migration.sql:114-117`). Si se olvidara, el sintoma no
--      seria un saldo torcido: seria que NINGUN premio se puede registrar jamas, con un 23514.
--   5) El CHECK de `premio_dia`, mismo patron de falla-cerrado: la columna solo puede estar
--      llena en las dos categorias del premio, y `premio_ranking` no puede existir sin ella.
--   6) `pago_mensajero_movimiento_origen_uq` con predicado nuevo (§3.3), y
--   7) los DOS unicos parciales del premio y de su reverso.
--
-- POR QUE UNA COLUMNA Y NO LA CLAVE DE ORIGEN (§3.3, R17/R19). Con `origen_id = cierreId` la
-- unicidad que la base impondria seria «un premio por (mensajero, CIERRE)», que no es lo que el
-- humano pidio y ademas esta MAL: medido, `cierre_dia` NO tiene ningun indice unico
-- (`20260712100000_cierre_dia/migration.sql:39-42`: tres indices, ninguno UNIQUE), asi que un
-- cierre puede arrastrar DOS dias de trabajo; el premio del segundo dia chocaria con el del
-- primero y volveria como «ya registrado» — un fallo mudo sobre dinero. Con `premio_dia` la
-- guarda es literalmente `(mensajero, dia)`, medible con un INSERT y sin razonamiento
-- intermedio.
--
-- POR QUE HAY QUE RETOCAR EL UNICO DE ORIGEN (paso 6). Sin el retoque, el choque anterior
-- seguiria vivo por la otra puerta: dos premios de dias distintos imputados al mismo cierre
-- comparten `(cierre_dia, cierreId, mensajeroId, premio_ranking)`. El cambio es QUIRURGICO y se
-- dice con precision: el feed del cierre escribe `pago_devengado` y `pago_efectivo`, que SIGUEN
-- dentro del predicado y conservan su proteccion intacta; `ajuste_pago` HOY NO LO ESCRIBE NADIE
-- (verificado: solo aparece en tipos, rotulos y catalogo de metricas, en ninguna escritura), asi
-- que sacarlo no relaja nada vivo; y las dos categorias que salen quedan protegidas por indices
-- MAS estrictos, no menos.
--
-- PATRON «ENUM NUEVO USADO EN LA MISMA MIGRACION»: tiene precedente APLICADO EN PRODUCCION en
-- `20260803120000_caja_tesoreria/migration.sql`, que anade dos valores (lineas 28 y 31) y los usa
-- en el CHECK de las lineas 61-71 del mismo archivo. Se replica ese patron. El `IF NOT EXISTS`
-- lo hace idempotente ante un reintento y NO se quita.
--
-- ADITIVA: no renombra, no reordena y no retira ningun valor previo de ningun enum; no mueve ni
-- una fila (sin INSERT/UPDATE/DELETE) y no hay backfill que hacer —hoy no existe ninguna fila de
-- premio—.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `pago_mensajero_movimiento` ya tiene
-- RLS habilitada sin policies (solo service role) desde 20260712180000 y sigue exactamente
-- igual. Esta migracion NO toca RLS ni policies.

-- 1) La categoria PROPIA del premio en el libro del mensajero (R14, decision (d)).
ALTER TYPE "pago_mensajero_movimiento_categoria" ADD VALUE IF NOT EXISTS 'premio_ranking';

-- 2) El origen del egreso de la caja: LA FILA DEL PODIO (R20, §3.4).
ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'ranking_snapshot_fila';

-- 3) La fecha calendario CR del podio. Nullable y sin backfill (§3.3).
ALTER TABLE "pago_mensajero_movimiento" ADD COLUMN "premio_dia" DATE;

-- 4) El CHECK tipo<->categoria de la 172, con `premio_ranking` en la rama `devengo` (R14).
--    El premio SUBE la cuenta por pagar, asi que es un devengo; ponerlo en la rama `pago` seria
--    exactamente el error que este CHECK existe para impedir.
ALTER TABLE "pago_mensajero_movimiento" DROP CONSTRAINT "pago_mensajero_movimiento_tipo_categoria_check";
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'devengo' AND "categoria" IN ('pago_devengado','ajuste_devengo','premio_ranking'))
  OR
  ("tipo" = 'pago' AND "categoria" IN ('pago_efectivo','liquidacion','ajuste_pago'))
);

-- 5) `premio_dia` solo tiene sentido en las DOS categorias del premio, y `premio_ranking` NO
--    puede existir sin ella: si pudiera, la guarda de R17 —que es un indice PARCIAL sobre
--    (mensajero_id, premio_dia)— dejaria pasar filas con NULL y la unicidad se evaporaria en
--    silencio. `ajuste_pago` la lleva porque es el REVERSO del premio (§7.1) y necesita la misma
--    coordenada; un `ajuste_pago` que no sea reverso de un premio va con NULL y cae en la
--    primera rama.
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_premio_dia_check"
CHECK (
  ("premio_dia" IS NULL     AND "categoria" <> 'premio_ranking')
  OR
  ("premio_dia" IS NOT NULL AND "categoria" IN ('premio_ranking','ajuste_pago'))
);

-- 6) El unico de origen del feed del cierre, con las dos categorias del premio FUERA (§3.3).
--    Mismo nombre y misma forma; solo cambia el predicado.
DROP INDEX "pago_mensajero_movimiento_origen_uq";
CREATE UNIQUE INDEX "pago_mensajero_movimiento_origen_uq"
  ON "pago_mensajero_movimiento"("origen_tipo", "origen_id", "mensajero_id", "categoria")
  WHERE "origen_id" IS NOT NULL AND "categoria" NOT IN ('premio_ranking','ajuste_pago');

-- 7a) R17 — LA GUARDA NO NEGOCIABLE: UN premio por (mensajero, dia del podio), impuesta por la
--     BASE y no por una comprobacion del servicio. Es lo que hace que el segundo intento sea un
--     `ON CONFLICT DO NOTHING` sin check-then-insert y sin TOCTOU.
CREATE UNIQUE INDEX "pago_mensajero_movimiento_premio_dia_uq"
  ON "pago_mensajero_movimiento"("mensajero_id", "premio_dia")
  WHERE "categoria" = 'premio_ranking';

-- 7b) R31 — UNA anulacion por premio, por la misma via: la segunda compensacion no se escribe.
CREATE UNIQUE INDEX "pago_mensajero_movimiento_premio_reverso_uq"
  ON "pago_mensajero_movimiento"("mensajero_id", "premio_dia")
  WHERE "categoria" = 'ajuste_pago' AND "premio_dia" IS NOT NULL;
