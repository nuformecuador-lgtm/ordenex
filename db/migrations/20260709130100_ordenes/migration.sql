-- CreateTable
-- "num_guia" es SERIAL: Postgres crea la secuencia "orden_num_guia_seq" y asigna
-- un entero autoincremental por insercion (R8/R14); el usuario nunca lo provee.
CREATE TABLE "orden" (
    "id" TEXT NOT NULL,
    "num_guia" SERIAL NOT NULL,
    "num_remision" TEXT NOT NULL,
    "estatus_id" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "telefono_dest" TEXT NOT NULL,
    "tienda_id" TEXT NOT NULL,
    "zona_id" TEXT NOT NULL,
    "provincia_id" TEXT NOT NULL,
    "canton_id" TEXT NOT NULL,
    "distrito_id" TEXT,
    "producto" TEXT NOT NULL,
    "peso" DECIMAL(10,3) NOT NULL,
    "notas" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orden_num_guia_key" ON "orden"("num_guia");

-- CreateIndex
CREATE UNIQUE INDEX "orden_num_remision_key" ON "orden"("num_remision");

-- CreateIndex
CREATE INDEX "orden_tienda_id_idx" ON "orden"("tienda_id");

-- CreateIndex
CREATE INDEX "orden_estatus_id_idx" ON "orden"("estatus_id");

-- CreateIndex
CREATE INDEX "orden_created_at_idx" ON "orden"("created_at");

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_estatus_id_fkey" FOREIGN KEY ("estatus_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_tienda_id_fkey" FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_provincia_id_fkey" FOREIGN KEY ("provincia_id") REFERENCES "provincia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_canton_id_fkey" FOREIGN KEY ("canton_id") REFERENCES "canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden" ADD CONSTRAINT "orden_distrito_id_fkey" FOREIGN KEY ("distrito_id") REFERENCES "distrito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): "orden" solo se accede desde el
-- servidor (Prisma con service role). Sin policies para anon/authenticated, por lo
-- que RLS bloquea todo acceso salvo el service role. La autorizacion fina por
-- rol/dueno (R19-R24) vive en OrdenService, no en policies.
ALTER TABLE "orden" ENABLE ROW LEVEL SECURITY;
