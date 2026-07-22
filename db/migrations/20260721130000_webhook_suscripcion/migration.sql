-- Feature 99 (design §1.1, R1/R2): tabla de suscripcion de webhook por OWNER. Migracion
-- ADITIVA: no altera tablas existentes. Orden: tabla -> indice unico -> FK -> RLS.
--
-- Va DESPUES de 20260721120000_job_tipo_webhook_estado (que anadio el valor del enum) para
-- respetar el 55P04; esta migracion NO consume el enum, solo crea la tabla del suscriptor.

-- R1: una fila por owner. `secret` guarda el CIPHERTEXT del secreto de firma (AES-256-GCM,
-- design §1.3, D2/R32), NUNCA texto plano. `activa` default true; baja = activa=false (R8).
CREATE TABLE "webhook_suscripcion" (
  "id" TEXT NOT NULL,
  "owner_usuario_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_suscripcion_pkey" PRIMARY KEY ("id")
);

-- R1/R6: `owner_usuario_id` UNICO -> a lo sumo UNA suscripcion por owner; el re-registro es
-- un upsert por esta clave (no una fila nueva).
CREATE UNIQUE INDEX "webhook_suscripcion_owner_usuario_id_key" ON "webhook_suscripcion" ("owner_usuario_id");

-- FK al owner (usuario dedicado de la API key). ON DELETE RESTRICT: no se borra un owner con
-- suscripcion viva sin retirarla antes.
ALTER TABLE "webhook_suscripcion"
  ADD CONSTRAINT "webhook_suscripcion_owner_usuario_id_fkey"
  FOREIGN KEY ("owner_usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R2: RLS habilitada SIN policies (solo service role), patron api_key / jobs / geocode_cache.
-- La tabla guarda un secreto (cifrado) y no es accesible desde el cliente.
ALTER TABLE "webhook_suscripcion" ENABLE ROW LEVEL SECURITY;
