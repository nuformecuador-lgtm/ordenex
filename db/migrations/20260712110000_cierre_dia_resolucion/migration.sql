-- Feature 38: resolucion del cierre del dia por el admin (aprobar/rechazar).
-- Migracion ADITIVA sobre cierre_dia (feature 37): columnas de auditoria money/audit
-- (R14) + motivo de rechazo (R11). NO toca RLS: "cierre_dia" ya tiene RLS habilitada
-- desde la migracion de la feature 37; se conserva sin cambios (solo service role).

-- Columnas de auditoria/motivo (nullable: NULL mientras el cierre esta `solicitado`).
ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_por" TEXT;
ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_at" TIMESTAMP(3);
ALTER TABLE "cierre_dia" ADD COLUMN "motivo_rechazo" TEXT;

-- FK a usuario (el admin que resolvio). ON DELETE SET NULL: si el admin se elimina,
-- el cierre se conserva con la auditoria degradada (no rota), patron design §1.2.
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_resuelto_por_fkey"
  FOREIGN KEY ("resuelto_por") REFERENCES "usuario"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Indice para el filtro/auditoria por resolutor (R14).
CREATE INDEX "cierre_dia_resuelto_por_idx" ON "cierre_dia"("resuelto_por");
