-- Rastro de la CORRECCION del desglose de pago de una gestion por parte de un admin/maestro
-- desde el detalle de un cierre ABIERTO (`solicitado`/`vencido`).
--
-- POR QUE DOS COLUMNAS Y NO NINGUNA: quien declaro el reparto fue el mensajero, en la calle, y
-- ese reparto es la `E` del `min(P, E)` con el que se le paga (feature 44) y el que cuadra su
-- caja. Que otra persona lo reescriba sin dejar quien ni cuando convierte una correccion
-- legitima en una discrepancia sin autor: el mensajero declaro efectivo, el cierre dice SINPE y
-- nadie sabe por que. Mismo patron —y mismos nombres— que `anulada_at`/`anulada_por` de la
-- feature 67 en esta misma tabla.
--
-- NULLABLES las dos: NULL = el desglose sigue siendo el que registro el mensajero, que es el
-- estado de TODAS las filas existentes. No hay backfill que hacer ni valor que inventar.
--
-- `ON DELETE SET NULL` en el actor, igual que `anulada_por` y que el actor del historial (49):
-- borrar al usuario no puede borrar el rastro de que la correccion ocurrio.
--
-- Sin tablas nuevas => sin RLS nueva: las columnas heredan las politicas de `gestion_orden`.
ALTER TABLE "gestion_orden" ADD COLUMN "pagos_editados_at" TIMESTAMP(3);
ALTER TABLE "gestion_orden" ADD COLUMN "pagos_editados_por" TEXT;

ALTER TABLE "gestion_orden"
  ADD CONSTRAINT "gestion_orden_pagos_editados_por_fkey"
  FOREIGN KEY ("pagos_editados_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El indice de la FK: lo crea Prisma para `anulada_por` por el mismo motivo (busquedas por
-- actor y coste del chequeo al borrar un usuario).
CREATE INDEX "gestion_orden_pagos_editados_por_idx" ON "gestion_orden"("pagos_editados_por");
