-- CreateEnum
CREATE TYPE "estado_usuario" AS ENUM ('pendiente', 'activo', 'inactivo', 'bloqueado');

-- NOTE: la tabla "Session" ya existe en la base de datos destino (modelo
-- preexistente en db/schema.prisma); esta migracion NO la recrea.

-- CreateTable
CREATE TABLE "tipo_identificacion" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "tipo_identificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "estado" "estado_usuario" NOT NULL DEFAULT 'pendiente',
    "cedula" TEXT NOT NULL,
    "tipo_identificacion_id" TEXT NOT NULL,
    "rol_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "email_usado" TEXT NOT NULL,
    "exitoso" BOOLEAN NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_device" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_otp_challenge" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipo_identificacion_value_key" ON "tipo_identificacion"("value");

-- CreateIndex
CREATE UNIQUE INDEX "rol_value_key" ON "rol"("value");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cedula_key" ON "usuario"("cedula");

-- CreateIndex
CREATE INDEX "usuario_tipo_identificacion_id_idx" ON "usuario"("tipo_identificacion_id");

-- CreateIndex
CREATE INDEX "usuario_rol_id_idx" ON "usuario"("rol_id");

-- CreateIndex
CREATE INDEX "login_attempt_usuario_id_created_at_idx" ON "login_attempt"("usuario_id", "created_at");

-- CreateIndex
CREATE INDEX "login_attempt_ip_address_created_at_idx" ON "login_attempt"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "trusted_device_usuario_id_idx" ON "trusted_device"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_device_usuario_id_device_hash_key" ON "trusted_device"("usuario_id", "device_hash");

-- CreateIndex
CREATE INDEX "email_otp_challenge_usuario_id_created_at_idx" ON "email_otp_challenge"("usuario_id", "created_at");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tipo_identificacion_id_fkey" FOREIGN KEY ("tipo_identificacion_id") REFERENCES "tipo_identificacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otp_challenge" ADD CONSTRAINT "email_otp_challenge_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): estas tablas solo se acceden
-- desde el servidor (Prisma con service role). Sin policies para anon/authenticated,
-- por lo que RLS bloquea todo acceso salvo el service role.
ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trusted_device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_otp_challenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tipo_identificacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rol" ENABLE ROW LEVEL SECURITY;
