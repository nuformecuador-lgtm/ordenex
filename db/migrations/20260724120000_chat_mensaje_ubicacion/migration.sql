-- Feature 121 (design §1.2, R7): UNICO cambio de esquema. Extension ADITIVA sobre la feature
-- 120/109 (chat 1:1 mensajero<->cliente) para persistir la UBICACION que el cliente comparte
-- por WhatsApp (`type=location`). Dos efectos:
--   (1) añade el valor `ubicacion` al enum `chat_mensaje_tipo`;
--   (2) añade dos columnas nullable `latitud`/`longitud` a `chat_mensaje` (solo las llenan
--       los entrantes de tipo `ubicacion` con coordenadas validas; el resto queda NULL).
--
-- GOTCHA 55P04 (unsafe use of new value of enum type): Postgres NO permite USAR un valor de
-- enum recien añadido en la MISMA transaccion que lo añadio. Prisma Migrate corre cada
-- migration.sql en una transaccion. Aqui el `ADD VALUE` y los `ADD COLUMN` solo DECLARAN el
-- valor y las columnas; NO usan `ubicacion` en un INSERT/UPDATE/comparacion, asi que conviven
-- en la misma migracion sin disparar el 55P04. El primer USO del valor ocurre en
-- transacciones posteriores (los inserts del webhook en runtime). Mismo precedente que la
-- feature 106 (20260722130000_cancelacion_api_por_key) y la 107 (..._carga_api).
-- `IF NOT EXISTS` hace el `ADD VALUE` idempotente ante reintentos.
--
-- Aditiva: no toca RLS (heredada de la 120, `chat_mensaje` conserva su RLS sin policies) ni
-- ninguna otra tabla.
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'ubicacion';
ALTER TABLE "chat_mensaje" ADD COLUMN "latitud" DOUBLE PRECISION;
ALTER TABLE "chat_mensaje" ADD COLUMN "longitud" DOUBLE PRECISION;
