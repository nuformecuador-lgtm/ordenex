-- Feature 205 (design §1.1/§1.2/§1.3, D-D) — el REPARTO: pagar la cuenta por pagar de un
-- mensajero con UN importe que se trocea entre sus cierres pendientes.
--
-- (1) Tabla `liquidacion_reparto`: el ACTO. Fila INMUTABLE (sin updated_at/deleted_at, R52),
--     `clave_idempotencia` UNICA (R29), CHECK `monto_total > 0`, 2 FK RESTRICT (beneficiario y
--     actor) e indice `(mensajero_id, created_at DESC)` para auditar los repartos de alguien.
-- (2) Columna `liquidacion_pago.reparto_id`: NULLABLE, con FK RESTRICT e INDICE. Es lo que
--     permite reconstruir el resultado original de un reparto repetido (R28) con un
--     `WHERE reparto_id = ...`, en vez de inferirlo.
--
-- ADITIVA (R49): no reescribe ni una fila, no renombra nada, no borra nada. `liquidacion_pago`
-- solo GANA una columna nullable, su FK y su indice; los pagos existentes —y los que se sigan
-- registrando contra UN cierre desde /cierres-admin— se quedan con `reparto_id IS NULL`, que es
-- exactamente lo que significan. Cero backfill.
--
-- NO se crea ningun tipo nativo ni se anade valor a ningun enum (no hay una sola sentencia de
-- tipos abajo, y el test estatico lo afirma): por eso esta migracion NO obliga a tocar ningun
-- `down.sql` previo. La cicatriz de «enum nuevo => recrear el enum en los down anteriores» no
-- aplica aqui.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LO QUE ESTA MIGRACION NO HACE, Y NO PUEDE HACER NUNCA: anadir una RESTRICCION UNICA a
-- `liquidacion_pago`. `LiquidacionPagoRepository.esChoqueDeClave` lee un P2002 SIN pista como
-- choque de `clave_idempotencia` y lo justifica por escrito con que esa tabla «solo tiene dos
-- restricciones unicas». Bajo el driver adapter de Prisma 7 el `meta.target` de un P2002 llega
-- VACIO, asi que el choque de un unico NUEVO llegaria sin pista, se leeria como clave repetida,
-- el servicio releeria por la clave, no la encontraria y responderia `no_encontrado`: un pago
-- legitimo rechazado con el mensaje equivocado. Por eso `reparto_id` lleva SOLO indice y el
-- `UNIQUE` de la idempotencia del reparto vive en la tabla NUEVA (design §1.2).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- RLS habilitada SIN policies en la tabla nueva (solo service role, patron `liquidacion_pago` /
-- `liquidacion_anulacion` / `pago_mensajero_movimiento`), R49.

-- AlterTable
ALTER TABLE "liquidacion_pago" ADD COLUMN     "reparto_id" TEXT;

-- CreateTable
CREATE TABLE "liquidacion_reparto" (
    "id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "mensajero_id" TEXT NOT NULL,
    "monto_total" DECIMAL(12,2) NOT NULL,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_reparto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_reparto_clave_idempotencia_key" ON "liquidacion_reparto"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "liquidacion_reparto_mensajero_id_created_at_idx" ON "liquidacion_reparto"("mensajero_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "liquidacion_pago_reparto_id_idx" ON "liquidacion_pago"("reparto_id");

-- AddForeignKey
ALTER TABLE "liquidacion_pago" ADD CONSTRAINT "liquidacion_pago_reparto_id_fkey" FOREIGN KEY ("reparto_id") REFERENCES "liquidacion_reparto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_reparto" ADD CONSTRAINT "liquidacion_reparto_mensajero_id_fkey" FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_reparto" ADD CONSTRAINT "liquidacion_reparto_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §1.1 — dinero POSITIVO, igual que `liquidacion_pago_monto_check`. Un reparto de 0 no es un
-- acto: no habria nada que trocear. Prisma no expresa CHECK, asi que va a mano.
--
-- SIN `NOT VALID`: la tabla nace vacia en este mismo script, asi que la validacion de filas
-- existentes recorre cero filas. `NOT VALID` aqui solo serviria para perder la propiedad.
ALTER TABLE "liquidacion_reparto" ADD CONSTRAINT "liquidacion_reparto_monto_total_check"
  CHECK ("monto_total" > 0);

-- R49: RLS habilitada SIN policies (solo service role) en la tabla nueva.
ALTER TABLE "liquidacion_reparto" ENABLE ROW LEVEL SECURITY;
