-- Feature 24 (redefinida): relacion N:M entre zona y distrito via tabla puente
-- zona_distrito. Par (zona, distrito) unico (no se repite). ON DELETE CASCADE en
-- ambos lados: borrar una zona (delete fisico) arrastra sus filas puente, y borrar
-- un distrito (raro) tambien. El nombre del indice unico coincide con el que Prisma
-- espera para @@unique([zonaId, distritoId]).

-- CreateTable
CREATE TABLE "zona_distrito" (
    "id" TEXT NOT NULL,
    "zona_id" TEXT NOT NULL,
    "distrito_id" TEXT NOT NULL,

    CONSTRAINT "zona_distrito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zona_distrito_zona_id_distrito_id_key" ON "zona_distrito"("zona_id", "distrito_id");

-- CreateIndex
CREATE INDEX "zona_distrito_zona_id_idx" ON "zona_distrito"("zona_id");

-- CreateIndex
CREATE INDEX "zona_distrito_distrito_id_idx" ON "zona_distrito"("distrito_id");

-- AddForeignKey
ALTER TABLE "zona_distrito" ADD CONSTRAINT "zona_distrito_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zona_distrito" ADD CONSTRAINT "zona_distrito_distrito_id_fkey" FOREIGN KEY ("distrito_id") REFERENCES "distrito"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- Defensa en profundidad: solo acceso via service role del servidor, sin policies
-- para anon/authenticated (coherente con el resto del catalogo geografico).
ALTER TABLE "zona_distrito" ENABLE ROW LEVEL SECURITY;
