-- CreateTable
-- Cobro (feature 18): tarifas de flete/comision, multi-fila con "nombre" (D1).
-- Sin FK a zona/orden/tienda en esta feature (R1). Montos DECIMAL(12,2) (R2);
-- porcentajes 0..100 DECIMAL(5,2) (R3/D2/D3).
CREATE TABLE "cobro" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "valor_flete" DECIMAL(12,2) NOT NULL,
    "valor_flete_devuelto" DECIMAL(12,2) NOT NULL,
    "valor_flete_gam" DECIMAL(12,2) NOT NULL,
    "valor_flete_devuelto_gam" DECIMAL(12,2) NOT NULL,
    "fulfillment" DECIMAL(12,2) NOT NULL,
    "comision_cod" DECIMAL(5,2) NOT NULL,
    "iva_flete" DECIMAL(5,2) NOT NULL,
    "iva_comision_cod" DECIMAL(5,2) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Orden por defecto del listado (R18). Sin indice unico sobre "nombre" (ver
-- design.md "Unicidad de nombre"): requerido pero no unico (D1).
CREATE INDEX "cobro_created_at_idx" ON "cobro"("created_at");

-- EnableRowLevelSecurity
-- Defensa en profundidad (docs/architecture.md): "cobro" solo se accede desde el
-- servidor (Prisma con service role). Sin policies para anon/authenticated, por lo
-- que RLS bloquea todo acceso salvo el service role. La autorizacion fina por
-- rol (R9-R13) vive en CobroService, no en policies.
ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY;
