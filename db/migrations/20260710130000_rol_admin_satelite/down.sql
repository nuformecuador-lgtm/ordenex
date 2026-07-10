-- DOWN: Postgres no permite DROP VALUE de un enum -> se recrea el tipo sin 'adminSatelite'.
-- Precondicion (R5): ninguna fila de "usuario" referencia el rol 'adminSatelite'.
-- Si la hubiera, el DELETE falla por la FK usuario_rol_id_fkey y el rollback aborta.

DELETE FROM "rol" WHERE "value" = 'adminSatelite';

ALTER TYPE "rol_value" RENAME TO "rol_value_old";
CREATE TYPE "rol_value" AS ENUM ('maestro', 'admin', 'mensajero', 'Admin Tienda');
ALTER TABLE "rol" ALTER COLUMN "value" TYPE "rol_value" USING ("value"::text::"rol_value");
DROP TYPE "rol_value_old";
