-- Feature 40: cierre de NIVEL BODEGA (cierre_bodega).
-- (1) Tabla cierre_bodega: REUSA el enum "cierre_estado" de la feature 37 (NO se crea
--     un enum nuevo, F1.4-b). Snapshot de totales agregados (R10) + auditoria del
--     maestro (R20). FKs a zona (RESTRICT) y usuario (solicitado_por RESTRICT,
--     resuelto_por SET NULL). Indice unico parcial (R8) + RLS habilitada sin policies
--     (R24, solo service role, patron cierre_dia/gestion_orden/orden).
-- (2) FK nullable cierre_bodega_id en cierre_dia (R9/R21), ON DELETE SET NULL.
-- "zona"/"usuario"/"cierre_dia" ya tienen RLS de migraciones previas; NO se tocan.
-- El enum "cierre_estado" NO se toca (es de la feature 37).

-- 1) tabla cierre_bodega (reusa el enum cierre_estado de la feature 37).
CREATE TABLE "cierre_bodega" (
  "id" TEXT NOT NULL,
  "zona_id" TEXT NOT NULL,
  "solicitado_por" TEXT NOT NULL,
  "estado" "cierre_estado" NOT NULL DEFAULT 'solicitado',
  "total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_simpe" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_general" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "solicitado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resuelto_por" TEXT,
  "resuelto_at" TIMESTAMP(3),
  "motivo_rechazo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cierre_bodega_pkey" PRIMARY KEY ("id")
);

-- FKs: zona (RESTRICT), solicitado_por (RESTRICT), resuelto_por (SET NULL).
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_solicitado_por_fkey"
  FOREIGN KEY ("solicitado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_resuelto_por_fkey"
  FOREIGN KEY ("resuelto_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices normales: por zona, estado (cola), quien solicito, quien resolvio.
CREATE INDEX "cierre_bodega_zona_id_idx" ON "cierre_bodega"("zona_id");
CREATE INDEX "cierre_bodega_estado_idx" ON "cierre_bodega"("estado");
CREATE INDEX "cierre_bodega_solicitado_por_idx" ON "cierre_bodega"("solicitado_por");
CREATE INDEX "cierre_bodega_resuelto_por_idx" ON "cierre_bodega"("resuelto_por");

-- R8/F1.4-g: a lo sumo UN cierre de bodega `solicitado` por zona a la vez (defensa
-- DB contra doble solicitud concurrente). Prisma no expresa el indice parcial: va a
-- mano aqui.
CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"
  ON "cierre_bodega"("zona_id") WHERE "estado" = 'solicitado';

-- R24: RLS habilitada sin policies (solo service role), patron cierre_dia/orden.
ALTER TABLE "cierre_bodega" ENABLE ROW LEVEL SECURITY;

-- 2) FK nullable cierre_bodega_id en cierre_dia (R9/R21). ON DELETE SET NULL.
ALTER TABLE "cierre_dia" ADD COLUMN "cierre_bodega_id" TEXT;
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_cierre_bodega_id_fkey"
  FOREIGN KEY ("cierre_bodega_id") REFERENCES "cierre_bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cierre_dia_cierre_bodega_id_idx" ON "cierre_dia"("cierre_bodega_id");
