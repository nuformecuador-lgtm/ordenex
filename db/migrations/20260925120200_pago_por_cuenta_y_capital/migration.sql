-- FICHA 459 (3 de 3) — el pago por cuenta de una tienda y el saldo inicial o aporte de capital
-- (design §4.3). DDL de las tablas tomado de `prisma migrate diff`; los CHECK, a mano.
--
--   · `pago_por_cuenta_tienda` y `pago_por_cuenta_tienda_anulacion` (R29/R30/R46).
--   · `aporte_capital` y `aporte_capital_anulacion` (R68/R74).
--   · Los dos CHECK tipo<->categoria de los libros, AMPLIADOS con los valores de la migracion 1.
--
-- Documentos INMUTABLES (sin updated_at ni deleted_at): la anulacion es un documento aparte con
-- UNIQUE sobre el original, y «anulado» se deriva de que exista. SOLO DOS restricciones unicas por
-- documento (PK y clave): el repositorio trata un P2002 sin pista como choque de la clave.
-- FK ON DELETE RESTRICT. RLS habilitada SIN policies en las cuatro (solo service role, R99).
--
-- Los CHECK se recrean como AMPLIACION: validan las filas existentes, y como la lista nueva
-- CONTIENE a la vieja, ninguna fila previa puede hacerlos fallar.

-- ── Tablas ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "pago_por_cuenta_tienda" (
    "id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "tienda_id" TEXT NOT NULL,
    "beneficiario" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "metodo" "metodo_pago_value" NOT NULL,
    "referencia" TEXT,
    "motivo" TEXT NOT NULL,
    "fecha_pago" DATE NOT NULL,
    "comprobante_path" TEXT,
    "comprobante_content_type" TEXT,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_por_cuenta_tienda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pago_por_cuenta_tienda_anulacion" (
    "id" TEXT NOT NULL,
    "pago_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_por_cuenta_tienda_anulacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aporte_capital" (
    "id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "clase" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "comprobante_path" TEXT,
    "comprobante_content_type" TEXT,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aporte_capital_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aporte_capital_anulacion" (
    "id" TEXT NOT NULL,
    "aporte_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aporte_capital_anulacion_pkey" PRIMARY KEY ("id")
);

-- ── Indices ───────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "pago_por_cuenta_tienda_clave_idempotencia_key" ON "pago_por_cuenta_tienda"("clave_idempotencia");
CREATE INDEX "pago_por_cuenta_tienda_tienda_id_fecha_pago_idx" ON "pago_por_cuenta_tienda"("tienda_id", "fecha_pago");
CREATE UNIQUE INDEX "pago_por_cuenta_tienda_anulacion_pago_id_key" ON "pago_por_cuenta_tienda_anulacion"("pago_id");
CREATE UNIQUE INDEX "aporte_capital_clave_idempotencia_key" ON "aporte_capital"("clave_idempotencia");
CREATE UNIQUE INDEX "aporte_capital_anulacion_aporte_id_key" ON "aporte_capital_anulacion"("aporte_id");

-- ── Claves foraneas (RESTRICT) ────────────────────────────────────────────────────────────────
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_tienda_id_fkey" FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pago_por_cuenta_tienda_anulacion" ADD CONSTRAINT "pago_por_cuenta_tienda_anulacion_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago_por_cuenta_tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pago_por_cuenta_tienda_anulacion" ADD CONSTRAINT "pago_por_cuenta_tienda_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aporte_capital" ADD CONSTRAINT "aporte_capital_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aporte_capital_anulacion" ADD CONSTRAINT "aporte_capital_anulacion_aporte_id_fkey" FOREIGN KEY ("aporte_id") REFERENCES "aporte_capital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aporte_capital_anulacion" ADD CONSTRAINT "aporte_capital_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK de los documentos (Prisma no los expresa) ───────────────────────────────────────────
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_monto_check"
  CHECK ("monto" > 0);
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_beneficiario_check"
  CHECK (btrim("beneficiario") <> '' AND length("beneficiario") <= 120);
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_motivo_check"
  CHECK (btrim("motivo") <> '');
ALTER TABLE "pago_por_cuenta_tienda" ADD CONSTRAINT "pago_por_cuenta_tienda_comprobante_check"
  CHECK (("comprobante_path" IS NULL) = ("comprobante_content_type" IS NULL));
ALTER TABLE "pago_por_cuenta_tienda_anulacion" ADD CONSTRAINT "pago_por_cuenta_tienda_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

ALTER TABLE "aporte_capital" ADD CONSTRAINT "aporte_capital_clase_check"
  CHECK ("clase" IN ('saldo_inicial', 'aporte'));
ALTER TABLE "aporte_capital" ADD CONSTRAINT "aporte_capital_monto_check"
  CHECK ("monto" > 0);
ALTER TABLE "aporte_capital" ADD CONSTRAINT "aporte_capital_motivo_check"
  CHECK (btrim("motivo") <> '');
ALTER TABLE "aporte_capital" ADD CONSTRAINT "aporte_capital_comprobante_check"
  CHECK (("comprobante_path" IS NULL) = ("comprobante_content_type" IS NULL));
ALTER TABLE "aporte_capital_anulacion" ADD CONSTRAINT "aporte_capital_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

-- ── RLS (R99): habilitada SIN policies, solo service role ─────────────────────────────────────
ALTER TABLE "pago_por_cuenta_tienda" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pago_por_cuenta_tienda_anulacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aporte_capital" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aporte_capital_anulacion" ENABLE ROW LEVEL SECURITY;

-- ── Los dos CHECK tipo<->categoria, AMPLIADOS ─────────────────────────────────────────────────
-- Caja (lista de partida medida en la base el 2026-09-24 = la de `20260803120000_caja_tesoreria`).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital'))
);

-- Tienda (lista de partida = la de `20260908140100_wallet_tienda_check_cobro_manual`).
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta'))
);
