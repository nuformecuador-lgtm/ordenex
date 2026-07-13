-- Feature 42: wallet — caja PRINCIPAL de Ordenex (libro append-only de movimientos).
-- (1) 3 enums nativos (wallet_movimiento_tipo/categoria + wallet_origen_tipo).
-- (2) Tabla wallet_movimiento: fila INMUTABLE (sin updated_at/deleted_at, R1/R3), FK
--     registrado_por -> usuario (SET NULL). Indices de fecha (listado), (tipo,categoria)
--     (filtros) y (origen_tipo,origen_id) (buscar por origen) (R24). Indice UNICO PARCIAL
--     de idempotencia (origen_tipo,origen_id,categoria) WHERE origen_id IS NOT NULL
--     (R6/R13/R24; Prisma no expresa indice parcial -> va a mano). RLS habilitada sin
--     policies (solo service role, patron gestion_orden/cierre_dia/cierre_bodega, R22).
-- (3) ALTER TABLE orden ADD COLUMN cobra_comision (R26): DEFAULT true = retro-compatible
--     (las ordenes existentes quedan como "cobran comision", comportamiento actual).
-- Migracion ADITIVA (R23): no rompe la lectura de datos existentes.

-- 1) enums nativos.
CREATE TYPE "wallet_movimiento_tipo" AS ENUM ('ingreso', 'egreso');

CREATE TYPE "wallet_movimiento_categoria" AS ENUM (
  'ingreso_flete',
  'ingreso_flete_devolucion',
  'ingreso_comision_cod',
  'ingreso_iva_flete',
  'ingreso_iva_flete_devolucion',
  'ingreso_iva_comision_cod',
  'ingreso_ajuste',
  'egreso_pago_tienda',
  'egreso_pago_mensajero',
  'egreso_gasto',
  'egreso_sueldo',
  'egreso_ajuste'
);

CREATE TYPE "wallet_origen_tipo" AS ENUM (
  'cierre_dia',
  'gestion_orden',
  'manual',
  'pago_tienda',
  'pago_mensajero',
  'gasto'
);

-- 2) tabla wallet_movimiento (fila inmutable: sin updated_at/deleted_at).
CREATE TABLE "wallet_movimiento" (
  "id" TEXT NOT NULL,
  "tipo" "wallet_movimiento_tipo" NOT NULL,
  "categoria" "wallet_movimiento_categoria" NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "origen_tipo" "wallet_origen_tipo" NOT NULL,
  "origen_id" TEXT,
  "descripcion" TEXT,
  "registrado_por" TEXT,
  "fecha_movimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_movimiento_pkey" PRIMARY KEY ("id")
);

-- FK registrado_por -> usuario (SET NULL: borrar el usuario no borra el libro, R1).
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_registrado_por_fkey"
  FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices normales (R24): listado del libro por fecha, filtros por tipo/categoria,
-- buscar movimientos de un origen.
CREATE INDEX "wallet_movimiento_fecha_movimiento_idx" ON "wallet_movimiento"("fecha_movimiento");
CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"("tipo", "categoria");
CREATE INDEX "wallet_movimiento_origen_tipo_origen_id_idx" ON "wallet_movimiento"("origen_tipo", "origen_id");

-- R6/R13/R24: idempotencia por (origen_tipo, origen_id, categoria). Indice UNICO PARCIAL
-- (solo cuando origen_id IS NOT NULL: los manuales quedan fuera y no se deduplican).
-- Prisma no expresa indice parcial -> va a mano aqui. Con esto, un segundo intento de
-- alimentar el mismo (cierre_dia, <cierreId>, ingreso_flete) es un no-op via
-- ON CONFLICT DO NOTHING (createMany skipDuplicates), sin TOCTOU.
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo", "origen_id", "categoria")
  WHERE "origen_id" IS NOT NULL;

-- R22: RLS habilitada sin policies (solo service role), patron gestion_orden/cierre_dia.
ALTER TABLE "wallet_movimiento" ENABLE ROW LEVEL SECURITY;

-- 3) R26: bandera por-orden de cobro de comision COD. DEFAULT true = retro-compatible
-- (las ordenes existentes quedan como "cobran comision"; NOT NULL sin backfill manual).
ALTER TABLE "orden" ADD COLUMN "cobra_comision" BOOLEAN NOT NULL DEFAULT true;
