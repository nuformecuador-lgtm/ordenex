-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- NO toca tablas ni columnas preexistentes fuera de lo agregado por el UP.

-- Revertir estado de catalogo (R2/R21): elimina la fila SOLO si ninguna orden lo
-- referencia (patron feature 15/17/30), para no dejar una FK "orden.estatus_id"
-- colgando de una fila borrada. El valor 'en_bodega_satelite' del enum Postgres
-- standalone "order_status_value" NO se elimina: Postgres no soporta DROP VALUE
-- en un enum; queda documentado aqui. Es inocuo mientras ninguna fila lo
-- referencie.
DELETE FROM "order_status" WHERE "value" = 'en_bodega_satelite'
  AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s
    ON o."estatus_id"=s."id" WHERE s."value"='en_bodega_satelite');
