-- FICHA 458-B (2 de 2) — las tablas LATERALES de la wallet y los dos CHECK tipo<->categoria
-- AMPLIADOS (design §2.2). A mano: `db:migrate:create` falla con P3006 en este repo; el DDL de las
-- tablas sigue la forma que `prisma migrate diff` produce para los modelos de `db/schema.prisma`.
--
--   · `wallet_anotacion` (R42/R56/R59): «a quien» y la referencia de un movimiento de caja
--     registrado a mano SIN documento propio (sueldo, gasto de Ordenex, correccion de caja). 1:1 con
--     la fila del libro (`movimiento_id` UNIQUE). Inmutable: sin updated_at.
--   · `rechazo_tienda_cobro_anulacion` (R63/R64/R73, D7): la constancia de la anulacion de un cobro
--     por rechazo aprobado. `cobro_id` UNIQUE → se anula UNA vez (R66/R67). «Anulado» se deriva de
--     que exista la fila: `rechazo_tienda_cobro.estado` sigue `aprobado` (R73, A14 descartada).
--   · `wallet_comprobante` (R74–R80, D12): el archivo de los caminos SIN documento propio. UN
--     destino por fila (CHECK `num_nonnulls = 1`, precedente: el XOR de `liquidacion_pago`) y un
--     UNIQUE por destino: un segundo comprobante del mismo movimiento CHOCA (R79). La FK a
--     `liquidacion_pago` se declara AQUI: `liquidacion_pago` no gana ninguna restriccion (205).
--   · D13: NO se crea `wallet_movimiento_anulacion`. La 461 dejo `ajuste_caja_anulacion` (FK a
--     `wallet_movimiento(id)`, `movimiento_id` UNIQUE) y la 458 la REUTILIZA para la constancia de la
--     anulacion de sueldo, gasto, gasto fijo e indemnizacion (`progress/impl_458-B.md` §TB.0).
--   · RLS habilitada SIN policies en las tres (solo service role, R92).
--   · Los dos CHECK se recrean como AMPLIACION: la lista nueva CONTIENE a la de la 457
--     (`20260927120100_abono_tienda_457_tablas_y_checks`), asi que ninguna fila previa puede
--     hacerlos fallar.
--
-- R89: ninguna sentencia toca filas existentes (ni UPDATE, ni DELETE, ni INSERT).

-- ── Tablas ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "wallet_anotacion" (
    "id" TEXT NOT NULL,
    "movimiento_id" TEXT NOT NULL,
    "contraparte_nombre" TEXT,
    "referencia" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_anotacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rechazo_tienda_cobro_anulacion" (
    "id" TEXT NOT NULL,
    "cobro_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rechazo_tienda_cobro_anulacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_comprobante" (
    "id" TEXT NOT NULL,
    "caja_movimiento_id" TEXT,
    "tienda_movimiento_id" TEXT,
    "liquidacion_pago_id" TEXT,
    "storage_path" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "subido_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_comprobante_pkey" PRIMARY KEY ("id")
);

-- ── Indices ───────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "wallet_anotacion_movimiento_id_key" ON "wallet_anotacion"("movimiento_id");
CREATE UNIQUE INDEX "rechazo_tienda_cobro_anulacion_cobro_id_key" ON "rechazo_tienda_cobro_anulacion"("cobro_id");
CREATE INDEX "rechazo_tienda_cobro_anulacion_anulado_por_idx" ON "rechazo_tienda_cobro_anulacion"("anulado_por");
CREATE UNIQUE INDEX "wallet_comprobante_caja_movimiento_id_key" ON "wallet_comprobante"("caja_movimiento_id");
CREATE UNIQUE INDEX "wallet_comprobante_tienda_movimiento_id_key" ON "wallet_comprobante"("tienda_movimiento_id");
CREATE UNIQUE INDEX "wallet_comprobante_liquidacion_pago_id_key" ON "wallet_comprobante"("liquidacion_pago_id");
CREATE INDEX "wallet_comprobante_subido_por_idx" ON "wallet_comprobante"("subido_por");

-- R59: el filtro «A quien» por nombre libre busca sin distinguir mayusculas. Indice de EXPRESION:
-- Prisma no lo expresa y vive solo aqui (un `migrate diff` futuro puede proponer soltarlo: esa
-- linea se borra del diff, el indice no).
CREATE INDEX "wallet_anotacion_contraparte_nombre_lower_idx" ON "wallet_anotacion"(lower("contraparte_nombre"));

-- ── Claves foraneas (RESTRICT: ni el libro, ni el cobro, ni el pago, ni quien actuo se borran) ──
ALTER TABLE "wallet_anotacion" ADD CONSTRAINT "wallet_anotacion_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "wallet_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rechazo_tienda_cobro_anulacion" ADD CONSTRAINT "rechazo_tienda_cobro_anulacion_cobro_id_fkey" FOREIGN KEY ("cobro_id") REFERENCES "rechazo_tienda_cobro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rechazo_tienda_cobro_anulacion" ADD CONSTRAINT "rechazo_tienda_cobro_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_caja_movimiento_id_fkey" FOREIGN KEY ("caja_movimiento_id") REFERENCES "wallet_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_tienda_movimiento_id_fkey" FOREIGN KEY ("tienda_movimiento_id") REFERENCES "wallet_tienda_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_liquidacion_pago_id_fkey" FOREIGN KEY ("liquidacion_pago_id") REFERENCES "liquidacion_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_subido_por_fkey" FOREIGN KEY ("subido_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CHECK (Prisma no los expresa) ─────────────────────────────────────────────────────────────
-- Una anotacion dice algo: al menos uno de los dos datos, y ninguno en blanco.
ALTER TABLE "wallet_anotacion" ADD CONSTRAINT "wallet_anotacion_contraparte_nombre_check"
  CHECK ("contraparte_nombre" IS NULL OR btrim("contraparte_nombre") <> '');
ALTER TABLE "wallet_anotacion" ADD CONSTRAINT "wallet_anotacion_referencia_check"
  CHECK ("referencia" IS NULL OR btrim("referencia") <> '');
ALTER TABLE "wallet_anotacion" ADD CONSTRAINT "wallet_anotacion_no_vacia_check"
  CHECK (num_nonnulls("contraparte_nombre", "referencia") >= 1);

ALTER TABLE "rechazo_tienda_cobro_anulacion" ADD CONSTRAINT "rechazo_tienda_cobro_anulacion_motivo_check"
  CHECK (btrim("motivo") <> '');

-- UN destino por comprobante (R79 lo completan los tres UNIQUE de arriba).
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_un_destino_check"
  CHECK (num_nonnulls("caja_movimiento_id", "tienda_movimiento_id", "liquidacion_pago_id") = 1);
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_storage_path_check"
  CHECK (btrim("storage_path") <> '');
-- La lista de `WALLET_COMPROBANTE_MIME` (`lib/config/wallet-comprobante.ts`), la misma de la 459.
ALTER TABLE "wallet_comprobante" ADD CONSTRAINT "wallet_comprobante_content_type_check"
  CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

-- ── RLS (R92): habilitada SIN policies, solo service role ─────────────────────────────────────
ALTER TABLE "wallet_anotacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rechazo_tienda_cobro_anulacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_comprobante" ENABLE ROW LEVEL SECURITY;

-- ── Los dos CHECK tipo<->categoria, AMPLIADOS ─────────────────────────────────────────────────
-- Caja: la lista de la 457 + los dos reversos de CARGO del cobro por rechazo (egresos).
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
     'egreso_reverso_abono_tienda',
     'egreso_reverso_flete_devolucion','egreso_reverso_iva_flete_devolucion'))
);

-- Tienda: la lista de la 457 + los dos creditos espejo de la anulacion del cobro por rechazo.
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado',
     'abono_tienda',
     'flete_devolucion_anulado','iva_flete_devolucion_anulado'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete',
     'iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito','cobro_manual','pago_por_cuenta',
     'abono_tienda_anulado'))
);
