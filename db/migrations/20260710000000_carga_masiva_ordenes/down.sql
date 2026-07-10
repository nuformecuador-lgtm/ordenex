-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca tablas ni columnas preexistentes fuera de lo agregado por el UP.

-- Revertir FK e indice de mensajero_sugerido_id (R2)
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey";
DROP INDEX IF EXISTS "orden_mensajero_sugerido_id_idx";

-- Revertir columnas nuevas (R1)
ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_sugerido_id";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "monto_cobrar";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "direccion";

-- Revertir el seed del estatus (R6): solo si ninguna orden lo referencia, para
-- no dejar una FK "orden.estatus_id" colgando de una fila borrada.
DELETE FROM "order_status" WHERE "value" = 'en_preparacion' AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s ON o."estatus_id"=s."id" WHERE s."value"='en_preparacion');

-- Revertir peso a NOT NULL (R4). ADVERTENCIA: esta sentencia falla explicitamente
-- si existen ordenes con peso NULL (p.ej. creadas por la carga masiva); en ese
-- caso el rollback requiere resolver esos datos manualmente antes de reintentar
-- (no se corrompen datos silenciosamente).
ALTER TABLE "orden" ALTER COLUMN "peso" SET NOT NULL;
