-- CreateEnum (feature 50). Patron CREATE TYPE "rol_value"/"order_status_value".
CREATE TYPE "vehiculo_value" AS ENUM ('moto', 'carro', 'camion');

-- CreateTable. OJO: columna "name" (NO "value" como rol/order_status/tipo_id).
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "name" "vehiculo_value" NOT NULL,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (catalogo: name unico -> idempotencia del seed, base del FK 21).
CREATE UNIQUE INDEX "vehiculos_name_key" ON "vehiculos"("name");

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): "vehiculos" solo se accede desde
-- el servidor (Prisma con service role). Sin policies para anon/authenticated, por
-- lo que RLS bloquea todo acceso salvo el service role. La autorizacion fina por
-- rol (solo maestro, R9/R10) vive en VehiculoService, no en policies.
ALTER TABLE "vehiculos" ENABLE ROW LEVEL SECURITY;
