-- Feature 24: catalogo global de zonas con pagos + flag GAM, y asignacion por
-- distrito (distrito.zona_id) y usuario (usuario.zona_id). NO toca la tabla "orden"
-- (R10): sus FKs directas a zona/provincia/canton/distrito quedan intactas.
--
-- NOTA (blocker R4): el DROP total de provincia.zona_id (+FK+indice) queda DIFERIDO.
-- La carga masiva (feature 15) deriva orden.zona_id (NOT NULL) desde
-- provincia.zona_id; retirar la columna antes de migrar esa derivacion al modelo
-- por-distrito romperia esa feature. Como paso intermedio, aqui se RELAJA la
-- columna a NULLABLE para que el catalogo global (seed feature 24) pueda crear
-- provincias sin una zona (la zona ya no cuelga de la provincia). Ver progress/impl.
ALTER TABLE "provincia" ALTER COLUMN "zona_id" DROP NOT NULL;

-- zona: pagos + flag GAM (R1). Los DEFAULT cubren filas existentes sin backfill.
ALTER TABLE "zona" ADD COLUMN "pago_entrega" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "zona" ADD COLUMN "pago_rechazo" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "zona" ADD COLUMN "es_gam" BOOLEAN NOT NULL DEFAULT false;

-- nombre unico (R2). La normalizacion de comparacion se aplica en el service/seed
-- antes de escribir; este indice unico garantiza la invariante a nivel DB.
CREATE UNIQUE INDEX "zona_nombre_key" ON "zona"("nombre");

-- un solo es_gam=true (R3): indice unico parcial sobre es_gam donde es_gam = true.
CREATE UNIQUE INDEX "zona_es_gam_unico" ON "zona"("es_gam") WHERE "es_gam" = true;

-- distrito: zona_id nullable (R5) + FK RESTRICT (R7/R8) + indice de soporte.
ALTER TABLE "distrito" ADD COLUMN "zona_id" TEXT;
CREATE INDEX "distrito_zona_id_idx" ON "distrito"("zona_id");
ALTER TABLE "distrito" ADD CONSTRAINT "distrito_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- usuario: zona_id nullable (R6) + FK RESTRICT (R7/R8) + indice de soporte.
ALTER TABLE "usuario" ADD COLUMN "zona_id" TEXT;
CREATE INDEX "usuario_zona_id_idx" ON "usuario"("zona_id");
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (R12): zona, provincia, canton y distrito YA tienen Row Level Security
-- habilitado por la migracion 20260709130000_ordenes_catalogos_geografia (lineas
-- 70-73). Esta migracion NO lo re-habilita ni lo deshabilita; permanece activo,
-- sin policies para anon/authenticated (acceso solo via service role del servidor),
-- coherente con usuario/cobro/vehiculos.
