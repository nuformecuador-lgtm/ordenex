-- DOWN (feature 246, T1.1, R21) — repone el indice de dos columnas y suelta la columna.
--
-- ⚠️ ESTA REVERSION NO ES INOCUA, Y ESA ES LA DIFERENCIA CON LA DE LA 238. Aquella solo perdia un
-- rastro de auditoria. Esta CAMBIA EL COMPORTAMIENTO DE DOS SUBSISTEMAS EN CUANTO SE APLICA. Quien
-- haga rollback tiene que saber las dos cosas:
--
--   1. EL CORTE VUELVE A BARRER LO RESERVADO. Sin la columna, el predicado de proteccion desaparece
--      y LA PRIMERA CORRIDA POSTERIOR del corte nocturno transicionara a `sin_gestionar` las
--      ordenes que estaban reservadas para mañana, y creara los `cierre_dia` en estado `vencido`
--      que esta feature evitaba. Desde la 241 un `vencido` BLOQUEA al mensajero para gestionar y
--      cobrar. Es decir: revertir esto de noche le puede costar la jornada siguiente a un mensajero
--      que no hizo nada mal.
--
--   2. EL DENOMINADOR DEL RANKING VUELVE A `asignado_at` (design §6.bis). El ranking del DIA EN
--      CURSO cambia de numeros en la siguiente carga de `/ranking`. Los snapshots ya congelados NO
--      se ven afectados: `ranking_snapshot_dia`/`_fila` son inmutables por diseño (R42) y esta
--      feature nunca los reescribio.
--
-- PERDIDA DE DATO DECLARADA: se pierden todas las reservas vigentes. La columna nacio en esta
-- migracion, asi que revertirla es soltarla; no hay nada que preservar en otro sitio.
--
-- EL INDICE SE REPONE, NO SE OLVIDA. El `up` no CREO un indice suelto: **sustituyo** el compuesto
-- `(mensajero_asignado_id, asignado_at)` de la feature 76 por su version de TRES columnas. Un
-- `down` que solo soltara la columna dejaria la base **sin el indice de dos columnas**, y con el se
-- iria el `Index Only Scan` del que hoy depende el denominador del ranking Y el CTE `ids_del_dia`
-- de `TableroDiaRepository`. Eso NO seria «devolver la base al estado anterior»: seria dejarla
-- peor. Por eso se recrea explicitamente ANTES de soltar la columna (soltar la columna se llevaria
-- por delante el indice de tres, asi que el orden importa: primero hay uno vivo, luego se retira).
--
-- POR QUE R21 SE CUMPLE («la reversion deja la base en un estado que el codigo anterior a esta
-- feature puede leer sin cambios»): ese codigo NUNCA leyo esta columna —nace aqui— y el indice que
-- SI usaba queda repuesto con su nombre exacto. Ningun `SELECT`, ningun `select` de Prisma y
-- ninguna derivacion se queda sin su dato ni sin su plan.
--
-- `IF EXISTS` / `IF NOT EXISTS` en todas las sentencias para que el rollback sea IDEMPOTENTE (se
-- puede correr dos veces sin fallar).
CREATE INDEX IF NOT EXISTS "orden_mensajero_asignado_id_asignado_at_idx"
  ON "orden" ("mensajero_asignado_id", "asignado_at");

DROP INDEX IF EXISTS "orden_mensajero_asignado_at_fecha_reparto_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "fecha_reparto";
