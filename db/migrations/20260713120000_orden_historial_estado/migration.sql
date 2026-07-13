-- Feature 49: trazabilidad / historial de estados de la orden.
-- (1) enum nativo orden_historial_origen_tipo (11 valores, R23): clasifica cual de los
--     11 call-sites de escritura de `orden.estatus_id` produjo cada transicion.
-- (2) Tabla orden_historial_estado: HISTORIAL append-only e INMUTABLE (R2): SIN
--     updated_at/deleted_at, sin soft delete. `estatus_origen_id` NULL = creacion
--     (R1/R20); `actor_usuario_id` NULL = sistema/cron (R21). 5 FKs (orden, estatus
--     origen->order_status, estatus destino->order_status, actor->usuario ON DELETE SET
--     NULL, gestion->gestion_orden). 2 indices: (orden_id, created_at) para la linea de
--     tiempo (R5); (orden_id, estatus_destino_id) para el conteo de intentos (R24). RLS
--     habilitada sin policies (solo service role, patron gestion_orden/cierre_dia/
--     wallet_movimiento, R3).
-- Migracion ADITIVA: crea enum + tabla + FKs + indices + RLS; no altera tablas existentes.

-- 1) enum nativo de tipo de origen (R23).
CREATE TYPE "orden_historial_origen_tipo" AS ENUM (
  'carga_masiva',
  'creacion_manual',
  'generacion_guia',
  'asignacion_bodega',
  'ruteo_satelite',
  'recepcion_satelite',
  'asignacion_satelite',
  'recoleccion',
  'gestion',
  'liberacion_reprogramada',
  'ajuste_estado'
);

-- 2) tabla orden_historial_estado (fila inmutable: sin updated_at/deleted_at, R2).
CREATE TABLE "orden_historial_estado" (
  "id" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,
  "estatus_origen_id" TEXT,
  "estatus_destino_id" TEXT NOT NULL,
  "actor_usuario_id" TEXT,
  "origen_tipo" "orden_historial_origen_tipo" NOT NULL,
  "motivo" TEXT,
  "gestion_orden_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_historial_estado_pkey" PRIMARY KEY ("id")
);

-- FK orden -> orden (la orden usa soft-delete, no se borra fisicamente: el historial
-- nunca queda huerfano).
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK estatus origen -> order_status (nullable: NULL en la creacion, R1/R20).
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_estatus_origen_id_fkey"
  FOREIGN KEY ("estatus_origen_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK estatus destino -> order_status (NOT NULL).
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_estatus_destino_id_fkey"
  FOREIGN KEY ("estatus_destino_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK actor -> usuario ON DELETE SET NULL (borrar el usuario no borra el rastro, R21).
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_actor_usuario_id_fkey"
  FOREIGN KEY ("actor_usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK gestion -> gestion_orden (nullable: solo la familia gestion la lleva).
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey"
  FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indices: linea de tiempo por orden (R5) y conteo de intentos por destino (R24).
CREATE INDEX "orden_historial_estado_orden_id_created_at_idx" ON "orden_historial_estado"("orden_id", "created_at");
CREATE INDEX "orden_historial_estado_orden_id_estatus_destino_id_idx" ON "orden_historial_estado"("orden_id", "estatus_destino_id");

-- R3: RLS habilitada sin policies (solo service role), patron gestion_orden/cierre_dia/
-- wallet_movimiento. Un acceso con clave anonima es rechazado.
ALTER TABLE "orden_historial_estado" ENABLE ROW LEVEL SECURITY;
