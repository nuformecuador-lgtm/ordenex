-- DOWN (R24): Postgres no soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se
-- RECREA sin 'apiKey'. Patron identico al de 20260710130000_rol_admin_satelite/down.sql.
--
-- Precondicion: ninguna fila de "rol" con value='apiKey' (la borra el down.sql de
-- 20260716150000_api_key, que corre ANTES por orden inverso) y ninguna fila de
-- "usuario" que la referencie. Si quedara alguna, el ALTER falla RUIDOSAMENTE por la
-- FK usuario_rol_id_fkey y el rollback aborta: es el comportamiento correcto (primero
-- se borran las keys y sus usuarios dedicados).
--
-- La lista de valores debe coincidir con el enum ANTES de esta migracion:
--   maestro | admin | mensajero | 'Admin Tienda' (@map adminTienda) | adminSatelite
ALTER TYPE "rol_value" RENAME TO "rol_value_old";
CREATE TYPE "rol_value" AS ENUM ('maestro', 'admin', 'mensajero', 'Admin Tienda', 'adminSatelite');
ALTER TABLE "rol" ALTER COLUMN "value" TYPE "rol_value" USING ("value"::text::"rol_value");
DROP TYPE "rol_value_old";
