-- Feature 64 (R11/R12/R20, F1.4-b + F1.4-d): "deshacer gestion" — anulacion CON RASTRO de
-- una gestion (decision 2 del humano: se ANULA dejando huella, NO se borra) + el 12.º valor
-- del enum de origen del historial para que la linea de tiempo distinga un deshacer de una
-- gestion real.
--
-- Migracion ADITIVA: dos columnas nullable en `gestion_orden`, su FK/indices y un valor de
-- enum. NO altera columnas ni policies preexistentes; NO hay tabla nueva -> NO hay RLS nueva
-- (`gestion_orden` ya tiene RLS habilitada sin policies desde 20260711150000, solo service
-- role: sigue igual).

-- 1) Columnas de anulacion (NULL = gestion VIGENTE, patron `cierre_id IS NULL` de la 37).
-- `anulada_at`/`anulada_por` son el espejo de `cierre_dia.resuelto_at`/`resuelto_por` (38).
-- ON DELETE SET NULL como el actor del historial (49/R21): borrar al usuario no borra el
-- rastro de la anulacion. NO se anade `updated_at` ni se toca ningun campo original de la
-- gestion (R12: resultado/monto/metodo/motivo/fecha/evidencia/mensajero/created_at intactos).
ALTER TABLE "gestion_orden" ADD COLUMN "anulada_at" TIMESTAMP(3);
ALTER TABLE "gestion_orden" ADD COLUMN "anulada_por" TEXT;

ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_anulada_por_fkey"
  FOREIGN KEY ("anulada_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gestion_orden_anulada_por_idx" ON "gestion_orden"("anulada_por");

-- 2) Indice PARCIAL de la ruta caliente (R13/R16/R17): las gestiones VIGENTES sin cierre de
-- un mensajero (`/cierre-dia` en vivo, `solicitarCierre` y el cron del corte diario de la
-- 41). Prisma no expresa indices parciales -> va a mano aqui (mismo patron que
-- `orden_liberada_reprogramada_at_idx` de la 46 y los indices parciales de wallet_movimiento
-- / cierre_bodega).
CREATE INDEX "gestion_orden_mensajero_pendiente_idx"
  ON "gestion_orden" ("mensajero_id")
  WHERE "cierre_id" IS NULL AND "anulada_at" IS NULL;

-- 3) 12.º valor del enum de origen del historial (R20, F1.4-b): la transicion que produce el
-- deshacer se registra con `origen_tipo = 'deshacer_gestion'`, distinguible de una gestion
-- real en la linea de tiempo. Patron "enum-existente" (precedente reversible:
-- 20260712150000_cierre_estado_vencido): ALTER TYPE ... ADD VALUE no puede correr en la misma
-- transaccion que USE el valor; aqui NADIE lo usa (solo se anade). `IF NOT EXISTS` lo hace
-- idempotente si se reintenta.
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_gestion';
