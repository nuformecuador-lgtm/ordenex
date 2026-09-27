-- FICHA 461 (5 de 6 — hallazgos de la auditoria de la wallet, D2 y D3).
-- DDL tomado de `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script`
-- sobre el clon `ordenex_461`; el CHECK del motivo y el RLS, a mano (Prisma no los expresa).
--
-- D2 (R66/R67/R68) — CLAVE DE IDEMPOTENCIA en la propia fila de los tres movimientos que una
-- persona DECIDE y que hasta hoy se insertaban con `origen_id NULL`, fuera del indice unico parcial:
--   · `wallet_tienda_movimiento.clave_idempotencia` → el cobro de Ordenex a una tienda (`cobro_manual`);
--   · `wallet_movimiento.clave_idempotencia`        → la correccion de caja (`ingreso_ajuste`/
--                                                     `egreso_ajuste`) y el sueldo o gasto de Ordenex
--                                                     (`egreso_sueldo`/`egreso_gasto_variable`).
--   Columna NULLABLE + indice UNIQUE: Postgres trata los NULL como distintos, asi que todo lo
--   automatico (feeds del cierre, contra-asientos, migraciones de datos) sigue sin clave y sin
--   choque. Un doble envio con la misma clave choca en el indice y `ON CONFLICT DO NOTHING` lo deja
--   en 0 filas: el servicio relee por la clave y responde `ya_registrado`. Medido en produccion por
--   la auditoria (Q2): 0 filas dobles, asi que NO hay backfill.
--
-- D3 (R69/R70/R71) — `ajuste_caja_anulacion`: la ANULACION de una correccion de caja. Molde:
--   `cobro_tienda_anulacion` (migracion 2 de esta ficha). `movimiento_id` UNIQUE → se anula UNA vez;
--   la FK apunta a la fila del libro porque la correccion ES esa fila. «Anulado» se deriva de que
--   exista la fila. FKs ON DELETE RESTRICT. RLS habilitada SIN policies (solo service role, R64).

-- ── D2: las dos columnas y sus indices unicos ─────────────────────────────────────────────────
ALTER TABLE "wallet_movimiento" ADD COLUMN     "clave_idempotencia" TEXT;
ALTER TABLE "wallet_tienda_movimiento" ADD COLUMN     "clave_idempotencia" TEXT;

CREATE UNIQUE INDEX "wallet_movimiento_clave_idempotencia_key" ON "wallet_movimiento"("clave_idempotencia");
CREATE UNIQUE INDEX "wallet_tienda_movimiento_clave_idempotencia_key" ON "wallet_tienda_movimiento"("clave_idempotencia");

-- ── D3: la tabla de la anulacion ──────────────────────────────────────────────────────────────
CREATE TABLE "ajuste_caja_anulacion" (
    "id" TEXT NOT NULL,
    "movimiento_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajuste_caja_anulacion_pkey" PRIMARY KEY ("id")
);

-- Se anula UNA vez (R70).
CREATE UNIQUE INDEX "ajuste_caja_anulacion_movimiento_id_key" ON "ajuste_caja_anulacion"("movimiento_id");

-- Claves foraneas (RESTRICT): ni el libro ni quien anulo se borran.
ALTER TABLE "ajuste_caja_anulacion" ADD CONSTRAINT "ajuste_caja_anulacion_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "wallet_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ajuste_caja_anulacion" ADD CONSTRAINT "ajuste_caja_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK del motivo (R69; Prisma no lo expresa).
ALTER TABLE "ajuste_caja_anulacion" ADD CONSTRAINT "ajuste_caja_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

-- RLS (R64/R71): habilitada SIN policies, solo service role.
ALTER TABLE "ajuste_caja_anulacion" ENABLE ROW LEVEL SECURITY;
