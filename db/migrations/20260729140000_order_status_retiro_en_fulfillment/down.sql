-- DOWN (T5.2, R38) — revierte EXACTAMENTE lo que hace `migration.sql`, en orden inverso.
--
-- Los tres pasos del UP se deshacen asi:
--   3 -> 1. repone el value en el catalogo si el UP llego a borrarlo (base sin historial);
--   2 -> 2. devuelve a `en_fulfillment` SOLO las ordenes marcadas por el rastro del UP que
--           sigan en `en_preparacion`;
--   1 -> 3. borra el rastro.
--
-- El paso 2 es la razon de ser del rastro: sin el no habria forma de distinguir una orden que
-- estaba en `en_fulfillment` de una que ya estaba en `en_preparacion` antes de la migracion, y
-- el DOWN moveria ordenes que nunca toco. La condicion `sigan en en_preparacion` es deliberada:
-- si una orden migrada AVANZO despues (le generaron guia, llego a bodega...), el rollback NO la
-- retrocede — deshacer la migracion no puede deshacer la operacion del negocio.
--
-- NO toca RLS, columnas, indices ni ningun otro value del catalogo.

-- 1. Repone el value si el UP lo borro (paso 3 del UP; en produccion no lo habra borrado).
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'en_fulfillment'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'en_fulfillment');

-- 2. Devuelve SOLO las ordenes marcadas por el rastro del UP que sigan en `en_preparacion`
--    (incluidas las borradas logicamente, igual que el UP). Solo `estatus_id`: ni num_guia, ni
--    mensajero, ni prioridad.
UPDATE "orden" o
SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_fulfillment')
WHERE o."estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_preparacion')
  AND EXISTS (SELECT 1 FROM "orden_historial_estado" h
              WHERE h."orden_id" = o."id"
                AND h."motivo" = 'migracion 155: retiro de en_fulfillment');

-- 3. Borra el rastro que dejo el paso 1 del UP. Es la UNICA fila de historial que este DOWN
--    toca: el resto de la linea de tiempo (incluidas las filas preexistentes que referencian
--    `en_fulfillment`) queda intacto, porque el UP tampoco las toco.
DELETE FROM "orden_historial_estado"
WHERE "motivo" = 'migracion 155: retiro de en_fulfillment';
