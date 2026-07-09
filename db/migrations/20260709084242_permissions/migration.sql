-- CreateTable
CREATE TABLE "permiso" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permiso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permiso" (
    "rol_id" TEXT NOT NULL,
    "permiso_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rol_permiso_pkey" PRIMARY KEY ("rol_id", "permiso_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permiso_method_route_key" ON "permiso"("method", "route");

-- CreateIndex
CREATE INDEX "rol_permiso_permiso_id_idx" ON "rol_permiso"("permiso_id");

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permiso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): estas tablas solo se acceden
-- desde el servidor (Prisma con service role). Sin policies para anon/authenticated,
-- por lo que RLS bloquea todo acceso salvo el service role.
ALTER TABLE "permiso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rol_permiso" ENABLE ROW LEVEL SECURITY;
