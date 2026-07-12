-- Feature 36: flujo del mensajero "Mis asignaciones" y gestion de ordenes.
-- (1) Dos estados nuevos de catalogo order_status (R1/R3, decision F1.4-a,b):
--     en_reparto (recogida por el mensajero) y rechazada (resultado RECHAZO).
-- (2) Enum nativo metodo_pago_value (R5, F1.4-c).
-- (3) Enum nativo gestion_resultado (R6, F1.4-d).
-- (4) Puntero de bloqueo 1-a-1 usuario.orden_en_gestion_id (R19-R21, F1.4-e).
-- (5) Tabla gestion_orden con RLS + indices + FKs (R6-R8, F1.4-d).
-- "orden"/"usuario"/"order_status" ya tienen RLS habilitada desde migraciones
-- previas; se conservan sin cambios, sin agregar policies (acceso solo por
-- service role, patron feature 6/15/17/21).

-- 1) estados nuevos de order_status (patron features 17/28/30).
-- NOTA para el runner de migraciones: "ALTER TYPE ... ADD VALUE" no puede
-- ejecutarse dentro de una transaccion en versiones antiguas de Postgres; el
-- "IF NOT EXISTS" lo hace idempotente si se reintenta o si el runner separa esta
-- sentencia de una transaccion implicita.
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_reparto';
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'rechazada';
INSERT INTO "order_status" ("id","value") VALUES
  (gen_random_uuid()::text,'en_reparto'),
  (gen_random_uuid()::text,'rechazada')
  ON CONFLICT ("value") DO NOTHING;

-- 2) enum metodo de pago (R5, F1.4-c). OJO 'SIMPE' en mayusculas.
CREATE TYPE "metodo_pago_value" AS ENUM ('efectivo','SIMPE','transferencia');

-- 3) enum resultado de gestion (R6, F1.4-d).
CREATE TYPE "gestion_resultado" AS ENUM ('entregada','reprogramada','devuelta','rechazada');

-- 4) puntero de bloqueo 1-a-1 (R19-R21, F1.4-e): FK nullable -> orden,
-- ON DELETE SET NULL (si la orden se borra, el puntero queda NULL) + indice.
ALTER TABLE "usuario" ADD COLUMN "orden_en_gestion_id" TEXT;
CREATE INDEX "usuario_orden_en_gestion_id_idx" ON "usuario"("orden_en_gestion_id");
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_orden_en_gestion_id_fkey"
  FOREIGN KEY ("orden_en_gestion_id") REFERENCES "orden"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) tabla gestion_orden + FKs + indices + RLS (R6-R8, F1.4-d).
CREATE TABLE "gestion_orden" (
  "id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,
  "mensajero_id" TEXT NOT NULL,
  "resultado" "gestion_resultado" NOT NULL,
  "monto_recibido" DECIMAL(12,2),
  "metodo_pago" "metodo_pago_value",
  "evidencia_storage_path" TEXT,
  "evidencia_content_type" TEXT,
  "motivo" TEXT,
  "fecha_reprogramacion" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gestion_orden_pkey" PRIMARY KEY ("id")
);

-- FK a orden (R6): ON UPDATE CASCADE, sin CASCADE en delete (la gestion es un
-- registro operativo que sobrevive por trazabilidad; una orden con gestiones no
-- se borra en fisico en esta feature, solo soft delete).
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- FK a usuario (R6): el mensajero que registro la gestion (el actor).
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indices por orden_id y por mensajero_id (R7).
CREATE INDEX "gestion_orden_orden_id_idx" ON "gestion_orden"("orden_id");
CREATE INDEX "gestion_orden_mensajero_id_idx" ON "gestion_orden"("mensajero_id");

-- RLS (R7): defensa en profundidad. "gestion_orden" solo se accede desde el
-- servidor (Prisma con service role). Sin policies para anon/authenticated, por
-- lo que RLS bloquea todo acceso salvo el service role, coherente con
-- "mensajero_documento"/"usuario"/"orden".
ALTER TABLE "gestion_orden" ENABLE ROW LEVEL SECURITY;
