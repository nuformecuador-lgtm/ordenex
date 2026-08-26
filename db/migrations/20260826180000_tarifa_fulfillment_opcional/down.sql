-- Revierte `tarifas.fulfillment` a NOT NULL.
--
-- OJO: el ALTER falla si alguna fila quedo con NULL desde que se aplico el up (toda tarifa de
-- zona creada por la UI nueva). El backfill a 0 va ANTES y es SEGURO: NULL y 0 significan lo
-- mismo para esta columna (ver el up), asi que no se inventa ningun cobro.

UPDATE "tarifas" SET "fulfillment" = 0 WHERE "fulfillment" IS NULL;
ALTER TABLE "tarifas" ALTER COLUMN "fulfillment" SET NOT NULL;
