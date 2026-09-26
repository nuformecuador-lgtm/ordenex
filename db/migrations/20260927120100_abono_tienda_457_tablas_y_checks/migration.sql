-- FICHA 457 (2 de 2) — el documento del PAGO DE UNA TIENDA A ORDENEX, su anulacion y los dos CHECK
-- tipo<->categoria AMPLIADOS (design §3.1–§3.3). DDL de las tablas tomado de `prisma migrate diff`;
-- los CHECK, a mano.
--
--   · `abono_tienda` (R1/R5/R17): documento INMUTABLE (sin updated_at ni deleted_at). SOLO DOS
--     restricciones unicas (PK y `clave_idempotencia`, R13/R25): el repositorio trata un P2002 sin
--     pista como choque de la clave. FK RESTRICT a `usuario` (la tienda que paga y quien registro).
--   · `abono_tienda_anulacion` (R31/R36): `abono_id` UNIQUE → se anula UNA vez; «anulado» se deriva
--     de que exista la fila. El motivo vive aqui (R63).
--   · RLS habilitada SIN policies en las dos (solo service role, R76).
--   · Los dos CHECK se recrean como AMPLIACION: la lista nueva CONTIENE a la vieja (la de
--     `20260926120100_cobro_tienda_461_anulacion_y_checks`, medida en el clon el 2026-09-25 —M4 de
--     design §14— antes de escribir esto), asi que ninguna fila previa puede hacerlos fallar.

-- ── Tablas ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "abono_tienda" (
    "id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "tienda_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "metodo" "metodo_pago_value" NOT NULL,
    "referencia" TEXT,
    "motivo" TEXT NOT NULL,
    "fecha_pago" DATE NOT NULL,
    "comprobante_path" TEXT,
    "comprobante_content_type" TEXT,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abono_tienda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abono_tienda_anulacion" (
    "id" TEXT NOT NULL,
    "abono_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abono_tienda_anulacion_pkey" PRIMARY KEY ("id")
);

-- ── Indices ───────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "abono_tienda_clave_idempotencia_key" ON "abono_tienda"("clave_idempotencia");
CREATE INDEX "abono_tienda_tienda_id_fecha_pago_idx" ON "abono_tienda"("tienda_id", "fecha_pago");
CREATE UNIQUE INDEX "abono_tienda_anulacion_abono_id_key" ON "abono_tienda_anulacion"("abono_id");

-- ── Claves foraneas (RESTRICT) ────────────────────────────────────────────────────────────────
ALTER TABLE "abono_tienda" ADD CONSTRAINT "abono_tienda_tienda_id_fkey" FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "abono_tienda" ADD CONSTRAINT "abono_tienda_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "abono_tienda_anulacion" ADD CONSTRAINT "abono_tienda_anulacion_abono_id_fkey" FOREIGN KEY ("abono_id") REFERENCES "abono_tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "abono_tienda_anulacion" ADD CONSTRAINT "abono_tienda_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK de los documentos (Prisma no los expresa) ───────────────────────────────────────────
ALTER TABLE "abono_tienda" ADD CONSTRAINT "abono_tienda_monto_check"
  CHECK ("monto" > 0);
ALTER TABLE "abono_tienda" ADD CONSTRAINT "abono_tienda_motivo_check"
  CHECK (btrim("motivo") <> '');
ALTER TABLE "abono_tienda" ADD CONSTRAINT "abono_tienda_comprobante_check"
  CHECK (("comprobante_path" IS NULL) = ("comprobante_content_type" IS NULL));
ALTER TABLE "abono_tienda_anulacion" ADD CONSTRAINT "abono_tienda_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

-- ── RLS (R76): habilitada SIN policies, solo service role ─────────────────────────────────────
ALTER TABLE "abono_tienda" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "abono_tienda_anulacion" ENABLE ROW LEVEL SECURITY;

-- ── Los dos CHECK tipo<->categoria, AMPLIADOS ─────────────────────────────────────────────────
-- Caja: los doce ingresos y los once egresos de la 461, mas la entrada del pago de una tienda a
-- Ordenex (ingreso, terceros, efectivo) y su reverso (egreso, terceros, efectivo).
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital',
     'ingreso_cobro_tienda',
     'ingreso_abono_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital',
     'egreso_reverso_cobro_tienda',
     'egreso_reverso_abono_tienda'))
);

-- Tienda: los cuatro creditos de la 461 mas el pago de la tienda a Ordenex; los diez debitos mas la
-- anulacion de ese pago.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado',
     'abono_tienda'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta',
     'abono_tienda_anulado'))
);
