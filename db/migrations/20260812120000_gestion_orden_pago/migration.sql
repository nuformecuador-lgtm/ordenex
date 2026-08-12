-- Feature 208 (R1/R2/R3/R4/R6/R7): DESGLOSE del recaudo al cliente de UNA entrega.
-- Tabla nueva ADITIVA con 0..N lineas (metodo, monto) por gestion. Patron
-- "tabla nueva sin tocar columnas/policies previas" (precedente
-- 20260723130000_gestion_orden_evidencia).
--
-- `gestion_orden.monto_recibido` SOBREVIVE como TOTAL snapshot y `gestion_orden.metodo_pago`
-- como columna DEPRECADA (R5): esta migracion NO las elimina, renombra ni cambia de tipo.
-- La invariante SUM(monto) = monto_recibido vive en el BORDE (zod + revalidacion Decimal en
-- el service), SIN CHECK ni trigger en la base (R10, patron 36/F1.4-b).
-- Tampoco toca cierre_dia / cierre_bodega / cierre_maestro / cierre_detail: los totales ya
-- snapshoteados quedan exactamente como estan (R8).

-- 1) Tabla 1:N de lineas de pago de una gestion (R1/R3). Sin columna `referencia` [D3] y sin
--    `indice`: el orden de lectura lo fija el enum (R22), no una columna que mantener.
CREATE TABLE "gestion_orden_pago" (
  "id"         TEXT NOT NULL,
  "gestion_id" TEXT NOT NULL,
  "metodo"     "metodo_pago_value" NOT NULL,
  "monto"      DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gestion_orden_pago_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gestion_orden_pago_gestion_id_metodo_key"
  ON "gestion_orden_pago" ("gestion_id", "metodo");                -- R2 [D2]
CREATE INDEX "gestion_orden_pago_gestion_id_idx"
  ON "gestion_orden_pago" ("gestion_id");                          -- R1

ALTER TABLE "gestion_orden_pago" ADD CONSTRAINT "gestion_orden_pago_gestion_id_fkey"
  FOREIGN KEY ("gestion_id") REFERENCES "gestion_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) RLS habilitada sin policies (solo service role, patron gestion_orden). (R4)
ALTER TABLE "gestion_orden_pago" ENABLE ROW LEVEL SECURITY;

-- 3) Backfill (R6/R7): cada gestion con recaudo escalar -> UNA linea (metodo_pago, monto_recibido).
--    El WHERE de TRES condiciones excluye a proposito:
--      - monto_recibido NULL  -> no hubo cobro que desglosar;
--      - monto_recibido = 0   -> entrega SIN COBRO (que hoy el panel disfraza de 'efectivo'):
--                                debe quedar en CERO lineas para coincidir con la semantica
--                                nueva (R14); sumar 0.00 a un balde no cambia ningun total,
--                                asi que la paridad al centavo (R27) se conserva exacta;
--      - metodo_pago NULL     -> `metodo` es NOT NULL: no hay fila que escribir (es el caso
--                                que hoy cae en el `default: break` de computeTotales y NO suma).
INSERT INTO "gestion_orden_pago" ("id", "gestion_id", "metodo", "monto", "created_at")
SELECT gen_random_uuid(), "id", "metodo_pago", "monto_recibido", "created_at"
FROM "gestion_orden"
WHERE "monto_recibido" IS NOT NULL
  AND "monto_recibido" > 0
  AND "metodo_pago" IS NOT NULL;
