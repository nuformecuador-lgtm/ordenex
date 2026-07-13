-- Feature 44: wallet — pago a mensajeros y cuentas por pagar. LIBRO append-only del pago a
-- cada mensajero (lo devengado y lo pagado; la cuenta por pagar es el saldo derivado).
-- (1) 2 enums nativos (pago_mensajero_movimiento_tipo/categoria). REUTILIZA el enum
--     wallet_origen_tipo de la 42 (cierre_dia/pago_mensajero/manual) -> NO se crea enum de
--     origen nuevo.
-- (2) Tabla pago_mensajero_movimiento: fila INMUTABLE (sin updated_at/deleted_at, R1/R3).
--     FK mensajero_id -> usuario ON DELETE RESTRICT (convencion de FKs no-nullables, igual
--     que orden.tienda_id / wallet_tienda_movimiento.tienda_id); FK registrado_por -> usuario
--     ON DELETE SET NULL (borrar el usuario no borra el libro). Indices
--     (mensajero_id,fecha_movimiento) (saldo/listado), (origen_tipo,origen_id) (por origen)
--     (R26). Indice UNICO PARCIAL de idempotencia (origen_tipo,origen_id,mensajero_id,
--     categoria) WHERE origen_id IS NOT NULL (R6/R12/R26; Prisma no expresa indice parcial ->
--     va a mano). RLS habilitada sin policies (solo service role, patron
--     wallet_movimiento/wallet_tienda_movimiento/cierre_dia, R24).
-- Migracion ADITIVA (R25): no altera tablas existentes ni rompe la lectura de datos ni los
-- enums de la 42 (los lados inversos de relacion en usuario no generan SQL).

-- 1) enums nativos (el enum de origen se reutiliza de la 42).
CREATE TYPE "pago_mensajero_movimiento_tipo" AS ENUM ('devengo', 'pago');

CREATE TYPE "pago_mensajero_movimiento_categoria" AS ENUM (
  'pago_devengado',
  'pago_efectivo',
  'liquidacion',
  'ajuste_devengo',
  'ajuste_pago'
);

-- 2) tabla pago_mensajero_movimiento (fila inmutable: sin updated_at/deleted_at).
CREATE TABLE "pago_mensajero_movimiento" (
  "id" TEXT NOT NULL,
  "mensajero_id" TEXT NOT NULL,
  "tipo" "pago_mensajero_movimiento_tipo" NOT NULL,
  "categoria" "pago_mensajero_movimiento_categoria" NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "origen_tipo" "wallet_origen_tipo" NOT NULL,
  "origen_id" TEXT,
  "descripcion" TEXT,
  "registrado_por" TEXT,
  "fecha_movimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pago_mensajero_movimiento_pkey" PRIMARY KEY ("id")
);

-- FK mensajero_id -> usuario ON DELETE RESTRICT (FK no-nullable, convencion orden.tienda_id).
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK registrado_por -> usuario ON DELETE SET NULL (borrar el usuario no borra el libro).
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_registrado_por_fkey"
  FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices normales (R26): saldo/listado por mensajero por fecha, buscar movimientos de un
-- origen (cierre).
CREATE INDEX "pago_mensajero_movimiento_mensajero_id_fecha_movimiento_idx" ON "pago_mensajero_movimiento"("mensajero_id", "fecha_movimiento");
CREATE INDEX "pago_mensajero_movimiento_origen_tipo_origen_id_idx" ON "pago_mensajero_movimiento"("origen_tipo", "origen_id");

-- R6/R12/R26: idempotencia por (origen_tipo, origen_id, mensajero_id, categoria). Indice UNICO
-- PARCIAL (solo cuando origen_id IS NOT NULL: los manuales quedan fuera y no se deduplican).
-- Prisma no expresa indice parcial -> va a mano aqui. Con esto, un segundo intento de alimentar
-- el mismo (cierre_dia, <cierreId>, <mensajeroId>, pago_devengado) es un no-op via
-- ON CONFLICT DO NOTHING (createMany skipDuplicates), sin TOCTOU.
CREATE UNIQUE INDEX "pago_mensajero_movimiento_origen_uq"
  ON "pago_mensajero_movimiento"("origen_tipo", "origen_id", "mensajero_id", "categoria")
  WHERE "origen_id" IS NOT NULL;

-- R24: RLS habilitada sin policies (solo service role), patron
-- wallet_movimiento/wallet_tienda_movimiento/cierre_dia.
ALTER TABLE "pago_mensajero_movimiento" ENABLE ROW LEVEL SECURITY;
