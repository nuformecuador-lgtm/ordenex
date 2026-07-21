-- Feature 84: periodicidad ARBITRARIA de las plantillas de gasto fijo. Hasta ahora el cron era
-- MENSUAL DIA 1 y estaba clavado (vercel.json `0 6 1 * *` + periodo YYYY-MM derivado del reloj);
-- ahora el cron es DIARIO y la plantilla declara su propio ciclo: unidad + cantidad + fecha de
-- cobro. Equivalencias: diaria = 1 dias; semanal = 1 semanas; quincenal = 2 semanas;
-- mensual = 1 meses. Admite cualquier otra (cada 3 dias, cada 6 meses).
--
-- Migracion ADITIVA: solo agrega el enum y 3 columnas a `gasto_fijo_plantilla`. No toca
-- `wallet_movimiento` ni ninguna otra tabla, y NO reescribe egresos ya emitidos.
--
-- BACKFILL — el comportamiento actual NO puede cambiar: las filas existentes migran a
-- `meses`/1 con `fecha_cobro = date_trunc('month', created_at)::date` (dia 1 del mes en que se
-- crearon), asi las plantillas viejas siguen cobrando MENSUAL EL DIA 1, exactamente como hoy.
-- Combinado con la clave de idempotencia `<plantillaId>:<YYYY-MM>` (que para `meses` NO cambia
-- de formato), el deploy no puede producir un doble cobro.
--
-- RLS: la tabla ya tiene RLS habilitada sin policies (solo service role, patron
-- wallet_movimiento). Esta migracion no la altera; la autorizacion de negocio vive en el service.

-- Unidad del ciclo. `meses` es el default: preserva el comportamiento pre-84 para toda fila
-- existente y para cualquier INSERT que no especifique periodicidad (la UI actual todavia no la
-- envia; ver los defaults del schema zod en lib/types/gasto-fijo-plantilla.ts).
CREATE TYPE "PeriodicidadUnidad" AS ENUM ('dias', 'semanas', 'meses');

ALTER TABLE "gasto_fijo_plantilla"
  ADD COLUMN "periodicidad_unidad" "PeriodicidadUnidad" NOT NULL DEFAULT 'meses',
  ADD COLUMN "periodicidad_cantidad" INTEGER NOT NULL DEFAULT 1,
  -- Ancla del ciclo (fecha del PRIMER cobro). Se agrega NULLABLE para poder backfillear las
  -- filas existentes y recien despues se fija NOT NULL (una columna DATE NOT NULL sin default
  -- fallaria sobre una tabla con datos).
  ADD COLUMN "fecha_cobro" DATE;

-- BACKFILL: las plantillas pre-84 cobraban mensual el dia 1 -> el ancla es el dia 1 del mes de
-- su creacion. `date_trunc('month', created_at)::date` da exactamente eso.
UPDATE "gasto_fijo_plantilla"
SET "fecha_cobro" = date_trunc('month', "created_at")::date
WHERE "fecha_cobro" IS NULL;

ALTER TABLE "gasto_fijo_plantilla"
  ALTER COLUMN "fecha_cobro" SET NOT NULL;

-- Un ciclo de 0 (o negativo) no tiene sentido y romperia el modulo (`% cantidad`). La logica
-- pura ya se defiende, pero el invariante se garantiza en la DB.
ALTER TABLE "gasto_fijo_plantilla"
  ADD CONSTRAINT "gasto_fijo_plantilla_periodicidad_cantidad_check"
  CHECK ("periodicidad_cantidad" >= 1);
