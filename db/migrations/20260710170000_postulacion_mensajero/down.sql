-- DOWN: revierte exactamente migration.sql de esta carpeta. No toca "vehiculos"
-- ni ninguna otra tabla preexistente. Se elimina la tabla dependiente y su FK
-- antes que el tipo del que dependen (R4/R5), y las columnas de "usuario" al
-- final (tras soltar su FK e indice).

-- Tabla de documentos (arrastra su FK e indices)
DROP TABLE IF EXISTS "mensajero_documento";

-- Tipo enum de los documentos (ya sin dependientes)
DROP TYPE IF EXISTS "mensajero_documento_tipo";

-- FK e indice de usuario.vehiculo_id antes de soltar la columna
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_vehiculo_id_fkey";
DROP INDEX IF EXISTS "usuario_vehiculo_id_idx";

-- Columnas nuevas de "usuario" (no se tocan las preexistentes)
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "placa";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "vehiculo_id";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "segundo_apellido";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "primer_apellido";
