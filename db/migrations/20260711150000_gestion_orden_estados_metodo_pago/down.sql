-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca tablas ni columnas preexistentes fuera de lo agregado por el UP.

-- 5) tabla gestion_orden (con sus FKs e indices; DROP TABLE los arrastra).
DROP TABLE IF EXISTS "gestion_orden";

-- 3) enum resultado de gestion (ya sin tabla que lo use).
DROP TYPE IF EXISTS "gestion_resultado";

-- 2) enum metodo de pago (ya sin tabla que lo use).
DROP TYPE IF EXISTS "metodo_pago_value";

-- 4) puntero de bloqueo 1-a-1: soltar FK e indice antes de dropear la columna.
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_orden_en_gestion_id_fkey";
DROP INDEX IF EXISTS "usuario_orden_en_gestion_id_idx";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "orden_en_gestion_id";

-- 1) estados de catalogo (R2/R3): elimina las filas SOLO si ninguna orden las
-- referencia (patron features 17/30), para no dejar una FK "orden.estatus_id"
-- colgando de una fila borrada. Los valores 'en_reparto'/'rechazada' del enum
-- Postgres standalone "order_status_value" NO se eliminan: Postgres no soporta
-- DROP VALUE en un enum; queda documentado aqui. Es inocuo mientras ninguna fila
-- los referencie.
DELETE FROM "order_status" WHERE "value" IN ('en_reparto','rechazada')
  AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s
    ON o."estatus_id"=s."id" WHERE s."value" IN ('en_reparto','rechazada'));
