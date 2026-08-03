-- Feature 172 (design §2.5) — LIQUIDACION: el pago como DOCUMENTO propio + la anulacion como
-- documento aparte + la condicion heredada del review de la 171 (los 2 CHECK tipo<->categoria
-- de los libros, que esta feature estrena como SEGUNDO escritor de ambos).
--
-- (1) Tabla `liquidacion_pago`: fila INMUTABLE (sin updated_at/deleted_at, R41), clave de
--     idempotencia UNICA (R44), 3 CHECK (beneficiario XOR, cierre sii mensajero, monto > 0),
--     3 indices y 4 FK. De cada fila nace EXACTAMENTE un movimiento en el libro del
--     beneficiario, enlazado con origen_tipo = pago_tienda|pago_mensajero y origen_id = este
--     id (R38): asi el indice unico parcial que los dos libros ya tienen da idempotencia sin
--     migracion de indice.
-- (2) Tabla `liquidacion_anulacion`: el estado "anulado" se DERIVA de que exista la fila; el
--     UNIQUE de `pago_id` es la restriccion DE DATOS que impide anular dos veces (R75).
-- (3) Los 2 `ADD CONSTRAINT ... CHECK` de tipo<->categoria sobre los dos libros (R58/R59/R60).
--
-- NO se crea ningun tipo nativo ni se anade ningun valor a ningun enum (deliberado, §2.1): el
-- SQL de abajo no lleva una sola sentencia de tipos, y el test estatico lo afirma. `metodo` reusa
-- `metodo_pago_value` (feature 36) y el contraasiento de la anulacion reusa las categorias de
-- ajuste que la 43/44 dejaron reservadas. Por eso esta migracion NO obliga a tocar ningun
-- down.sql previo (la cicatriz documentada de "enum nuevo => recrear el enum en los down
-- anteriores" NO aplica aqui).
--
-- ADITIVA (R64): no reescribe ni una fila existente; los libros solo GANAN una restriccion.
-- RLS habilitada SIN policies en las dos tablas nuevas (solo service role, patron
-- wallet_movimiento / wallet_tienda_movimiento / pago_mensajero_movimiento / cierre_dia, R63).

-- CreateTable
CREATE TABLE "liquidacion_pago" (
    "id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "mensajero_id" TEXT,
    "tienda_id" TEXT,
    "cierre_id" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "metodo" "metodo_pago_value" NOT NULL,
    "referencia" TEXT,
    "nota" TEXT,
    "fecha_pago" DATE NOT NULL,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_anulacion" (
    "id" TEXT NOT NULL,
    "pago_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anulado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_anulacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_pago_clave_idempotencia_key" ON "liquidacion_pago"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "liquidacion_pago_mensajero_id_fecha_pago_idx" ON "liquidacion_pago"("mensajero_id", "fecha_pago");

-- CreateIndex
CREATE INDEX "liquidacion_pago_tienda_id_fecha_pago_idx" ON "liquidacion_pago"("tienda_id", "fecha_pago");

-- CreateIndex
CREATE INDEX "liquidacion_pago_cierre_id_idx" ON "liquidacion_pago"("cierre_id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_anulacion_pago_id_key" ON "liquidacion_anulacion"("pago_id");

-- AddForeignKey
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_mensajero_id_fkey" FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_tienda_id_fkey" FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_anulacion" ADD CONSTRAINT "liquidacion_anulacion_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "liquidacion_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_anulacion" ADD CONSTRAINT "liquidacion_anulacion_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §2.3 — EXACTAMENTE un beneficiario. Lo garantiza la base, no el emisor: una fila sin
-- beneficiario no seria de nadie y una con los dos seria ambigua. Precedente literal en el
-- repo: `notificacion_destinatario_xor`.
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_beneficiario_check"
  CHECK (("mensajero_id" IS NULL) <> ("tienda_id" IS NULL));

-- §2.3 (R21, decisiones 2 y 4 del humano) — el cierre acompana al mensajero y SOLO a el: un
-- pago a un mensajero va SIEMPRE atado a un cierre aprobado; el pago a una tienda va contra su
-- saldo acumulado y no admite cierre.
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_cierre_check"
  CHECK (("mensajero_id" IS NULL) = ("cierre_id" IS NULL));

-- §2.3 (R11) — dinero POSITIVO. El signo lo da la categoria del movimiento, como en los libros.
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_monto_check"
  CHECK ("monto" > 0);

-- R63: RLS habilitada SIN policies (solo service role) en las dos tablas nuevas.
ALTER TABLE "liquidacion_pago" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "liquidacion_anulacion" ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- §2.3 — CHECK tipo <-> categoria de los DOS LIBROS. Condicion heredada del review de la 171
-- (`progress/review_171-desglose-por-tienda.md:249-275`): hasta hoy el invariante tenia un
-- solo guardian (el feed del cierre); la 172 es el SEGUNDO escritor de los dos libros y es
-- justo aqui donde deja de tenerlo.
--
-- FALLA CERRADO (R60): es una DISYUNCION DE LISTAS CERRADAS, no una negacion. Un valor futuro
-- del enum que nadie clasifique no casa ninguna rama y el INSERT se rechaza. Ruidoso a
-- proposito: mejor que la feature que anada el concepto tenga que tocar este CHECK, a que su
-- primera fila caiga en la cubeta equivocada y descuadre un saldo.
--
-- VALIDA LAS FILAS EXISTENTES al aplicarse (sin `NOT VALID`): verificado antes, en T A.0, con
-- el MCP de Supabase contra produccion (39 + 7 filas, CERO incoherentes). A ese volumen el
-- recorrido es instantaneo y no hace falta `NOT VALID` + `VALIDATE`.
--
-- La caja principal (tabla wallet_movimiento de la 42) NO recibe este CHECK (R62, [P8]): tiene
-- el mismo hueco y cuatro escritores, pero la 172 no la escribe; anadirle una restriccion que
-- valida filas existentes seria importar riesgo de despliegue sin contrapartida. Queda anotado
-- para la 173, que si la reescribe.

-- R58: cada concepto del ledger por tienda, atado a su unico tipo valido. `ajuste_credito`
-- vive en la rama `credito` porque es el CONTRAASIENTO de la anulacion de un pago a tienda
-- (§6.2): el CHECK y la anulacion se disenaron juntos.
ALTER TABLE "wallet_tienda_movimiento" ADD CONSTRAINT "wallet_tienda_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito'))
  OR
  ("tipo" = 'debito' AND "categoria" IN ('flete','flete_devolucion','comision_cod','iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito'))
);

-- R59: idem para el libro del pago al mensajero. `ajuste_devengo` vive en la rama `devengo`
-- porque es el CONTRAASIENTO de la anulacion de una liquidacion (§6.2): anular vuelve a subir
-- la cuenta por pagar del mensajero.
ALTER TABLE "pago_mensajero_movimiento" ADD CONSTRAINT "pago_mensajero_movimiento_tipo_categoria_check"
CHECK (
  ("tipo" = 'devengo' AND "categoria" IN ('pago_devengado','ajuste_devengo'))
  OR
  ("tipo" = 'pago' AND "categoria" IN ('pago_efectivo','liquidacion','ajuste_pago'))
);
