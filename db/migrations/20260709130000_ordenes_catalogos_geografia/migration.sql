-- CreateTable
CREATE TABLE "order_status" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "order_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zona" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "zona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provincia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "zona_id" TEXT NOT NULL,

    CONSTRAINT "provincia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canton" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "provincia_id" TEXT NOT NULL,

    CONSTRAINT "canton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distrito" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "canton_id" TEXT NOT NULL,

    CONSTRAINT "distrito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_status_value_key" ON "order_status"("value");

-- CreateIndex
CREATE INDEX "provincia_zona_id_idx" ON "provincia"("zona_id");

-- CreateIndex
CREATE INDEX "canton_provincia_id_idx" ON "canton"("provincia_id");

-- CreateIndex
CREATE INDEX "distrito_canton_id_idx" ON "distrito"("canton_id");

-- AddForeignKey
ALTER TABLE "provincia" ADD CONSTRAINT "provincia_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canton" ADD CONSTRAINT "canton_provincia_id_fkey" FOREIGN KEY ("provincia_id") REFERENCES "provincia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distrito" ADD CONSTRAINT "distrito_canton_id_fkey" FOREIGN KEY ("canton_id") REFERENCES "canton"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): estas tablas solo se acceden
-- desde el servidor (Prisma con service role). Sin policies para anon/authenticated,
-- por lo que RLS bloquea todo acceso salvo el service role.
ALTER TABLE "order_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zona" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provincia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canton" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distrito" ENABLE ROW LEVEL SECURITY;
