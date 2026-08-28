-- Feature 308 (design §1.4, R13) — UNICO cambio de esquema. Extension ADITIVA sobre la
-- 109/120/121 (chat 1:1 mensajero<->cliente) para que los entrantes que hoy caen en `otro` con
-- cuerpo NULL (burbuja vacia) tengan tipo propio y datos que pintar. Tres efectos:
--   (1) ocho valores nuevos en el enum `chat_mensaje_tipo`;
--   (2) nueve columnas NULLABLE en `chat_mensaje` (media, reaccion, contactos, cambio de numero);
--   (3) un indice PARCIAL para el agregado de reacciones por mensaje objetivo (R19).
--
-- GOTCHA 55P04 (unsafe use of new value of enum type): Postgres NO permite USAR un valor de
-- enum recien añadido en la MISMA transaccion que lo añadio, y Prisma Migrate corre cada
-- migration.sql en una transaccion. Aqui los `ADD VALUE` y los `ADD COLUMN` solo DECLARAN: no
-- hay ningun INSERT/UPDATE/comparacion contra los valores nuevos. El primer USO ocurre en
-- transacciones posteriores (los inserts del webhook en runtime). Mismo precedente que la
-- feature 121 (20260724120000_chat_mensaje_ubicacion) y la 106.
-- `IF NOT EXISTS` hace cada `ADD VALUE` idempotente ante reintentos.
--
-- ⛔ SIN BACKFILL (R14, design §1.5): los entrantes ya guardados como `otro` NO se reinterpretan.
-- Su payload crudo de Meta no se persistio (zod hace strip) y el binario de mas de 30 dias ya no
-- existe en Meta: no hay dato del que reconstruirlos. La UI los pinta con un aviso legible.
--
-- ⛔ SIN BINARIO EN REPOSO (D1/R15): no se crea bucket, ni columna `bytea`, ni tabla. Solo el
-- identificador de media de Meta y sus metadatos.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `chat_mensaje` ya tiene RLS habilitada
-- sin policies (solo service role) y sigue exactamente igual. `contactos_json` es PII en reposo y
-- hereda esa postura.

-- 1) Valores nuevos del enum. `otro` se CONSERVA como sumidero (tipos fuera de alcance y
--    degradaciones R3/R6/R8/R11).
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'imagen';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'audio';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'video';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'documento';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'sticker';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'reaccion';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'contactos';
ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'sistema';

-- 2) Columnas. Todas NULLABLE y sin DEFAULT: `ADD COLUMN` asi no reescribe la tabla en Postgres
--    (solo toca el catalogo), luego no hay ventana de bloqueo sobre una tabla que crece con cada
--    mensaje del chat. El `caption` NO tiene columna: va a `cuerpo` (R2), que es exactamente lo
--    que `cuerpo` significa (texto plano del mensaje).
ALTER TABLE "chat_mensaje" ADD COLUMN "media_id" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "media_mime" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "media_nombre" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "media_tamano_bytes" INTEGER;
ALTER TABLE "chat_mensaje" ADD COLUMN "reaccion_a_wa_message_id" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "reaccion_emoji" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "contactos_json" JSONB;
ALTER TABLE "chat_mensaje" ADD COLUMN "sistema_telefono_anterior" TEXT;
ALTER TABLE "chat_mensaje" ADD COLUMN "sistema_telefono_nuevo" TEXT;

-- 3) Indice PARCIAL del agregado de reacciones (R19): solo las filas que SON una reaccion
--    entran al indice; en un hilo normal son una minoria. En `schema.prisma` se declara el btree
--    equivalente con `map:` explicito (Prisma no expresa el predicado), mismo apaño y misma razon
--    que `chat_mensaje_error_codigo_idx`.
CREATE INDEX IF NOT EXISTS "chat_mensaje_reaccion_idx"
  ON "chat_mensaje" ("conversacion_id", "reaccion_a_wa_message_id")
  WHERE "reaccion_a_wa_message_id" IS NOT NULL;
