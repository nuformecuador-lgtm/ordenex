-- Feature 158 (T1.1, R1/R2/R9/R22) — camino del MENSAJERO del estado `incidente`:
--   1) `gestion_causa_incidente`: enum NUEVO, lista CERRADA de 3 valores EN ESPANOL
--      (`danado`/`perdido`/`robado`, decision Q-B del humano, design §0.3).
--   2) `gestion_resultado` + `incidente`: quinto resultado de la gestion del mensajero (R1).
--   3) `wallet_movimiento_categoria` + `egreso_indemnizacion`: concepto del egreso de la
--      caja principal (R2).
--   4) `gestion_orden.causa_incidente`: la causa tipificada del incidente (R9).
--   5) `gestion_orden.indemnizacion`: el monto que el admin captura AL APROBAR el cierre
--      (R22, Q-C). NULL mientras no se apruebe.
--
-- Patron "enum-existente" (features 41/45/67): `ALTER TYPE ... ADD VALUE` no puede correr en
-- la misma transaccion que USE el valor; aqui NADIE lo usa (solo se anaden), asi que es
-- seguro. El `IF NOT EXISTS` lo hace idempotente si se reintenta.
--
-- ADITIVA (R35/R36): no renombra, no reordena y no borra ningun valor previo de los dos
-- enums, no altera filas existentes (no hay INSERT ni UPDATE de datos) y no toca indices.
-- SIN CHECK constraint: la obligatoriedad de causa/evidencia vive SOLO en el borde (zod),
-- igual que `causa_devolucion` (73/F1.4-b) y que monto/metodo/evidencia de la 36.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `gestion_orden` y
-- `wallet_movimiento` ya tienen RLS habilitada sin policies (solo service role) desde
-- 20260711150000 / 20260712160000 y siguen exactamente igual. Esta migracion NO toca RLS ni
-- policies (precedente identico: 20260715160000_gestion_orden_causa_devolucion).

-- 1) Enum de la causa del incidente (lista CERRADA de 3, sin "Otro").
CREATE TYPE "gestion_causa_incidente" AS ENUM ('danado', 'perdido', 'robado');

-- 2) Quinto resultado de la gestion. Debe coincidir LITERALMENTE con el `value` del
-- catalogo `order_status` que la 154 dio de alta: `MisAsignacionesService.gestionar` resuelve
-- el estado destino con `findEstatusIdByValue(input.resultado)` (mapeo 1:1 por nombre).
ALTER TYPE "gestion_resultado" ADD VALUE IF NOT EXISTS 'incidente';

-- 3) Categoria del egreso de indemnizacion en la caja principal (42).
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_indemnizacion';

-- 4) Causa tipificada del incidente: NULLABLE y SIN default (patron `causa_devolucion`).
-- NULL = gestion no-`incidente`. Sin indice: no hay consulta declarada sobre esta columna.
ALTER TABLE "gestion_orden" ADD COLUMN "causa_incidente" "gestion_causa_incidente";

-- 5) Monto de la indemnizacion. NULLABLE y SIN default: se escribe DESPUES del INSERT de la
-- gestion, en la transaccion de aprobacion del cierre (mismo patron que `pago_mensajero` de
-- la 39 y `ingreso_bodega_rechazo` de la 56). DECIMAL(12,2) money-safe.
ALTER TABLE "gestion_orden" ADD COLUMN "indemnizacion" DECIMAL(12,2);
