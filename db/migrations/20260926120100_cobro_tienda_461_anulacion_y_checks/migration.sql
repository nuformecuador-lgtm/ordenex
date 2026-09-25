-- FICHA 461 (2 de 3) — la anulacion de un cobro de Ordenex a una tienda y los dos CHECK
-- tipo<->categoria AMPLIADOS (design §3.2). DDL de la tabla tomado de `prisma migrate diff`; los
-- CHECK, a mano.
--
--   · `cobro_tienda_anulacion` (R10/R15): `cobro_id` UNIQUE → un cobro se anula UNA vez; la FK apunta
--     a la fila `debito/cobro_manual` del libro de la tienda, porque el cobro ES esa fila (381/D2) y
--     no hay documento aparte (A5 descartada). «Anulado» se deriva de que exista la fila.
--     FK ON DELETE RESTRICT. RLS habilitada SIN policies (solo service role, R64).
--   · Los dos CHECK se recrean como AMPLIACION: la lista nueva CONTIENE a la vieja, asi que ninguna
--     fila previa puede hacerlos fallar. Listas de partida: las de
--     `20260925120200_pago_por_cuenta_y_capital`.

-- ── Tabla ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "cobro_tienda_anulacion" (
    "id" TEXT NOT NULL,
    "cobro_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobro_tienda_anulacion_pkey" PRIMARY KEY ("id")
);

-- ── Indice unico: se anula UNA vez (R15) ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX "cobro_tienda_anulacion_cobro_id_key" ON "cobro_tienda_anulacion"("cobro_id");

-- ── Claves foraneas (RESTRICT) ────────────────────────────────────────────────────────────────
ALTER TABLE "cobro_tienda_anulacion" ADD CONSTRAINT "cobro_tienda_anulacion_cobro_id_fkey" FOREIGN KEY ("cobro_id") REFERENCES "wallet_tienda_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cobro_tienda_anulacion" ADD CONSTRAINT "cobro_tienda_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK del motivo (R14; Prisma no lo expresa) ──────────────────────────────────────────────
ALTER TABLE "cobro_tienda_anulacion" ADD CONSTRAINT "cobro_tienda_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

-- ── RLS (R64): habilitada SIN policies, solo service role ─────────────────────────────────────
ALTER TABLE "cobro_tienda_anulacion" ENABLE ROW LEVEL SECURITY;

-- ── Los dos CHECK tipo<->categoria, AMPLIADOS ─────────────────────────────────────────────────
-- Caja: los once ingresos y los diez egresos de la 459, mas el cargo del cobro y su reverso.
ALTER TABLE "wallet_movimiento" DROP CONSTRAINT "wallet_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "wallet_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'ingreso' AND "categoria" IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
     'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod','ingreso_ajuste',
     'ingreso_cod_recaudado','ingreso_reverso_pago_tienda',
     'ingreso_reverso_pago_por_cuenta_tienda','ingreso_aporte_capital',
     'ingreso_cobro_tienda'))
  OR
  ("tipo" = 'egreso' AND "categoria" IN ('egreso_pago_tienda','egreso_pago_mensajero','egreso_gasto',
     'egreso_sueldo','egreso_ajuste','egreso_gasto_fijo','egreso_gasto_variable','egreso_indemnizacion',
     'egreso_pago_por_cuenta_tienda','egreso_reverso_aporte_capital',
     'egreso_reverso_cobro_tienda'))
);

-- Tienda: los tres creditos de la 459 mas la anulacion del cobro; los diez debitos, sin cambio.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta'))
);
