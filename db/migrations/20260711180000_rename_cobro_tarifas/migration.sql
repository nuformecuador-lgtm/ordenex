-- RenameTable
-- Renombra el dominio "cobro" a "tarifas" (tabla, PK y su indice) sin tocar
-- datos ni columnas existentes.
ALTER TABLE "cobro" RENAME TO "tarifas";
ALTER TABLE "tarifas" RENAME CONSTRAINT "cobro_pkey" TO "tarifas_pkey";
ALTER INDEX "cobro_created_at_idx" RENAME TO "tarifas_created_at_idx";

-- AlterTable
-- zona_id NULLABLE a proposito: "tarifas" puede tener filas ya persistidas y
-- un NOT NULL sin default fallaria contra datos existentes.
ALTER TABLE "tarifas" ADD COLUMN "zona_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "tarifas_zona_id_idx" ON "tarifas"("zona_id");

-- AddForeignKey
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "zona" ADD COLUMN "cobro_vehiculo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tarifa_zona_mensajero" (
    "id" TEXT NOT NULL,
    "cobro_entregado" DECIMAL(12,2) NOT NULL,
    "cobro_rechazado" DECIMAL(12,2) NOT NULL,
    "vehiculo_id" TEXT,
    "zona_id" TEXT NOT NULL,

    CONSTRAINT "tarifa_zona_mensajero_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tarifa_zona_mensajero_vehiculo_id_idx" ON "tarifa_zona_mensajero"("vehiculo_id");

-- CreateIndex
CREATE INDEX "tarifa_zona_mensajero_zona_id_idx" ON "tarifa_zona_mensajero"("zona_id");

-- AddForeignKey
ALTER TABLE "tarifa_zona_mensajero" ADD CONSTRAINT "tarifa_zona_mensajero_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa_zona_mensajero" ADD CONSTRAINT "tarifa_zona_mensajero_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): "tarifa_zona_mensajero" solo
-- se accede desde el servidor (Prisma con service role). Sin policies para
-- anon/authenticated, por lo que RLS bloquea todo acceso salvo el service role.
ALTER TABLE "tarifa_zona_mensajero" ENABLE ROW LEVEL SECURITY;
