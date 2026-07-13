-- Feature 43: wallet POR TIENDA — ledger append-only del saldo a favor de cada tienda.
-- (1) 2 enums nativos (wallet_tienda_movimiento_tipo/categoria). REUTILIZA el enum
--     wallet_origen_tipo de la 42 (cierre_dia/pago_tienda/manual) -> NO se crea enum de
--     origen nuevo.
-- (2) Tabla wallet_tienda_movimiento: fila INMUTABLE (sin updated_at/deleted_at, R1/R3).
--     FK tienda_id -> usuario ON DELETE RESTRICT (convencion de FKs no-nullables, igual
--     que orden.tienda_id); FK registrado_por -> usuario ON DELETE SET NULL (borrar el
--     usuario no borra el ledger). Indices (tienda_id,fecha_movimiento) (saldo/listado),
--     (tienda_id,categoria) (filtro por concepto), (origen_tipo,origen_id) (por origen)
--     (R26). Indice UNICO PARCIAL de idempotencia (origen_tipo,origen_id,tienda_id,
--     categoria) WHERE origen_id IS NOT NULL (R6/R13/R26; Prisma no expresa indice parcial
--     -> va a mano). RLS habilitada sin policies (solo service role, patron
--     wallet_movimiento/cierre_dia, R24).
-- Migracion ADITIVA (R25): no altera tablas existentes ni rompe la lectura de datos
-- (los lados inversos de relacion en usuario no generan SQL).

-- 1) enums nativos (el enum de origen se reutiliza de la 42).
CREATE TYPE "wallet_tienda_movimiento_tipo" AS ENUM ('credito', 'debito');

CREATE TYPE "wallet_tienda_movimiento_categoria" AS ENUM (
  'cod_recaudado',
  'flete',
  'flete_devolucion',
  'comision_cod',
  'iva_flete',
  'iva_flete_devolucion',
  'iva_comision_cod',
  'pago_tienda',
  'ajuste_credito',
  'ajuste_debito'
);

-- 2) tabla wallet_tienda_movimiento (fila inmutable: sin updated_at/deleted_at).
CREATE TABLE "wallet_tienda_movimiento" (
  "id" TEXT NOT NULL,
  "tienda_id" TEXT NOT NULL,
  "tipo" "wallet_tienda_movimiento_tipo" NOT NULL,
  "categoria" "wallet_tienda_movimiento_categoria" NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "origen_tipo" "wallet_origen_tipo" NOT NULL,
  "origen_id" TEXT,
  "descripcion" TEXT,
  "registrado_por" TEXT,
  "fecha_movimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_tienda_movimiento_pkey" PRIMARY KEY ("id")
);

-- FK tienda_id -> usuario ON DELETE RESTRICT (FK no-nullable, convencion orden.tienda_id).
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK registrado_por -> usuario ON DELETE SET NULL (borrar el usuario no borra el ledger).
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_registrado_por_fkey"
  FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices normales (R26): saldo/listado por tienda por fecha, filtro por concepto por
-- tienda, buscar movimientos de un origen (cierre).
CREATE INDEX "wallet_tienda_movimiento_tienda_id_fecha_movimiento_idx" ON "wallet_tienda_movimiento"("tienda_id", "fecha_movimiento");
CREATE INDEX "wallet_tienda_movimiento_tienda_id_categoria_idx" ON "wallet_tienda_movimiento"("tienda_id", "categoria");
CREATE INDEX "wallet_tienda_movimiento_origen_tipo_origen_id_idx" ON "wallet_tienda_movimiento"("origen_tipo", "origen_id");

-- R6/R13/R26: idempotencia por (origen_tipo, origen_id, tienda_id, categoria). Indice UNICO
-- PARCIAL (solo cuando origen_id IS NOT NULL: los manuales quedan fuera y no se deduplican).
-- Prisma no expresa indice parcial -> va a mano aqui. Con esto, un segundo intento de
-- alimentar el mismo (cierre_dia, <cierreId>, <tiendaId>, flete) es un no-op via
-- ON CONFLICT DO NOTHING (createMany skipDuplicates), sin TOCTOU.
CREATE UNIQUE INDEX "wallet_tienda_movimiento_origen_uq"
  ON "wallet_tienda_movimiento"("origen_tipo", "origen_id", "tienda_id", "categoria")
  WHERE "origen_id" IS NOT NULL;

-- R24: RLS habilitada sin policies (solo service role), patron wallet_movimiento/cierre_dia.
ALTER TABLE "wallet_tienda_movimiento" ENABLE ROW LEVEL SECURITY;
