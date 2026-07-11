-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- NO toca tablas ni columnas preexistentes fuera de lo agregado por el UP.

-- Revertir estado de catalogo (R10): solo si ninguna orden lo referencia (patron
-- feature 15), para no dejar una FK "orden.estatus_id" colgando de una fila
-- borrada. El valor 'en_espera_aceptacion' del enum Postgres standalone
-- "order_status_value" NO se elimina: Postgres no soporta DROP VALUE en un enum;
-- queda documentado aqui. Es inocuo mientras ninguna fila lo referencie.
DELETE FROM "order_status" WHERE "value" = 'en_espera_aceptacion'
  AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s
    ON o."estatus_id"=s."id" WHERE s."value"='en_espera_aceptacion');

-- Revertir mensajero_asignado_id (R7)
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_asignado_id_fkey";
DROP INDEX IF EXISTS "orden_mensajero_asignado_id_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_asignado_id";

-- Revertir num_guia a SERIAL NOT NULL (R1/R3/R6).
-- ADVERTENCIA: esta sentencia FALLA explicitamente si existen ordenes con
-- num_guia = NULL (p.ej. ordenes creadas por carga masiva o por el CRUD que aun
-- no pasaron por "Generar guia"); en ese caso el rollback requiere resolver esos
-- datos manualmente (asignar guia o borrarlas) antes de reintentar. No se
-- corrompen datos en silencio: ALTER COLUMN ... SET NOT NULL rechaza la
-- operacion completa si hay filas NULL.
ALTER SEQUENCE "orden_num_guia_seq" OWNED BY "orden"."num_guia";
ALTER TABLE "orden" ALTER COLUMN "num_guia" SET DEFAULT nextval('orden_num_guia_seq');
ALTER TABLE "orden" ALTER COLUMN "num_guia" SET NOT NULL;
