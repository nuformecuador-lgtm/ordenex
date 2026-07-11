-- Feature 24: catalogo global de zonas con pagos + flag GAM, y asignacion por
-- distrito (distrito.zona_id) y usuario (usuario.zona_id). NO toca la tabla "orden"
-- (R10): sus FKs directas a zona/provincia/canton/distrito quedan intactas.

-- Feature 24/R4: la zona deja de ser padre de la geografia. Se ELIMINA
-- provincia.zona_id (columna + FK + indice). La carga masiva (feature 15) ahora
-- deriva orden.zona_id del DISTRITO de la orden (distrito.zona_id), no de la
-- provincia (decision humana R4/R11 opcion b). Geografia vacia, sin backfill.
ALTER TABLE "provincia" DROP CONSTRAINT IF EXISTS "provincia_zona_id_fkey";
DROP INDEX IF EXISTS "provincia_zona_id_idx";
ALTER TABLE "provincia" DROP COLUMN "zona_id";

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
