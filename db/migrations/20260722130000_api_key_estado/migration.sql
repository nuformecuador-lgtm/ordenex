-- Feature: ciclo de vida de API keys (rotar/activar/desactivar). Agrega el estado PROPIO
-- de la fila `api_key` (no reusa el estado del usuario dedicado). Enum nativo
-- `estado_api_key` + columna `estado` con DEFAULT 'activa' NOT NULL.
--
-- Migracion ADITIVA: las filas existentes quedan 'activa' por el DEFAULT (ninguna key
-- previa se revoca al desplegar). No altera ninguna otra tabla.

-- El estado del enum se crea en la MISMA migracion que la columna: a diferencia de
-- `ALTER TYPE ... ADD VALUE`, `CREATE TYPE` de un enum nuevo NO cae en el 55P04 de
-- Postgres (no se usa un valor recien anadido a un tipo preexistente).
CREATE TYPE "estado_api_key" AS ENUM ('activa', 'inactiva');

-- DEFAULT 'activa' cubre a la vez las filas existentes (backfill implicito) y las
-- futuras generaciones (una key nace activa, feature 81).
ALTER TABLE "api_key"
  ADD COLUMN "estado" "estado_api_key" NOT NULL DEFAULT 'activa';
