-- Feature 37: modulo "Cierre del dia" del mensajero.
-- (1) Enums nativos cierre_estado (R13/R18) y cierre_destino_tipo (R15).
-- (2) Tabla cierre_dia con snapshot de totales + destino derivado + RLS + indices
--     + FKs (R13-R16/R18/R19).
-- (3) FK nullable cierre_id en gestion_orden (R13), ON DELETE SET NULL.
-- "usuario"/"zona"/"gestion_orden" ya tienen RLS habilitada desde migraciones
-- previas; se conservan sin cambios, sin agregar policies (acceso solo por
-- service role, patron feature 6/15/17/21/36).

-- 1) enums (a diferencia de ALTER TYPE ... ADD VALUE, CREATE TYPE si va en
-- transaccion; sin riesgo del patron enum-existente de features 17/30/36).
CREATE TYPE "cierre_estado" AS ENUM ('solicitado','aprobado','rechazado');
CREATE TYPE "cierre_destino_tipo" AS ENUM ('bodega_central','bodega_satelite');

-- 2) tabla cierre_dia + FKs + indices + RLS (R13-R16/R18/R19).
CREATE TABLE "cierre_dia" (
  "id" TEXT NOT NULL,
  "mensajero_id" TEXT NOT NULL,
  "estado" "cierre_estado" NOT NULL DEFAULT 'solicitado',
  "destino_tipo" "cierre_destino_tipo" NOT NULL,
  "destino_zona_id" TEXT NOT NULL,
  "total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_simpe" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_general" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "solicitado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cierre_dia_pkey" PRIMARY KEY ("id")
);

-- FK a usuario (el mensajero/actor) y a zona (destino derivado).
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_destino_zona_id_fkey"
  FOREIGN KEY ("destino_zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indices: por mensajero, por destino (feature 38 filtra por rol+zona) y por estado.
CREATE INDEX "cierre_dia_mensajero_id_idx" ON "cierre_dia"("mensajero_id");
CREATE INDEX "cierre_dia_destino_tipo_destino_zona_id_idx" ON "cierre_dia"("destino_tipo","destino_zona_id");
CREATE INDEX "cierre_dia_estado_idx" ON "cierre_dia"("estado");

-- RLS (R19): defensa en profundidad. "cierre_dia" solo se accede desde el servidor
-- (Prisma con service role). Sin policies para anon/authenticated, por lo que RLS
-- bloquea todo acceso salvo el service role, coherente con "gestion_orden"/"orden".
ALTER TABLE "cierre_dia" ENABLE ROW LEVEL SECURITY;

-- 3) FK nullable cierre_id en gestion_orden (R13): una gestion pertenece a un cierre
-- solo cuando se solicita. ON DELETE SET NULL (si el cierre se borra, la gestion
-- vuelve a quedar "del dia" sin cierre). Indice para el filtro cierre_id IS NULL (R3).
ALTER TABLE "gestion_orden" ADD COLUMN "cierre_id" TEXT;
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "gestion_orden_cierre_id_idx" ON "gestion_orden"("cierre_id");
