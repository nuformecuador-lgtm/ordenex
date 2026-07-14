-- Feature 45 (R33): tabla NUEVA `gasto_fijo_plantilla` — CONFIGURACION recurrente que el
-- maestro administra (CRUD). El cron mensual (`/api/cron/generar-gastos-fijos`) lee las
-- plantillas ACTIVAS y emite un egreso `egreso_gasto_fijo` en `wallet_movimiento` por cada
-- una, idempotente por (plantilla, periodo). NO es el libro: a diferencia de
-- wallet_movimiento (inmutable), esta tabla es MUTABLE (lleva updated_at; se edita y se
-- activa/desactiva). NO se borra (R25): la desactivacion (activa=false) detiene la
-- generacion futura y preserva el rastro.
-- Migracion ADITIVA (R33): no altera tablas existentes.
-- Patron `wallet_tienda_movimiento` (feature 43): tabla + indice + RLS habilitada sin
-- policies (solo service role, R20).

CREATE TABLE "gasto_fijo_plantilla" (
  "id" TEXT NOT NULL,
  "concepto" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gasto_fijo_plantilla_pkey" PRIMARY KEY ("id")
);

-- Indice por `activa`: el cron filtra WHERE activa = true (R27).
CREATE INDEX "gasto_fijo_plantilla_activa_idx" ON "gasto_fijo_plantilla"("activa");

-- R20: RLS habilitada sin policies (solo service role), patron wallet_movimiento/
-- wallet_tienda_movimiento.
ALTER TABLE "gasto_fijo_plantilla" ENABLE ROW LEVEL SECURITY;
