-- DOWN de la feature 308 (design §1.4, R13). Revierte EXACTAMENTE el migration.sql de esta
-- carpeta, en orden inverso:
--   (3) suelta el indice parcial de reacciones;
--   (2) elimina las nueve columnas de `chat_mensaje`;
--   (1) recrea el enum `chat_mensaje_tipo` SIN los ocho valores nuevos.
--
-- IRREVERSIBILIDAD PARCIAL DEL ENUM: Postgres NO soporta `ALTER TYPE ... DROP VALUE`. La unica
-- forma de "quitar" los ocho valores es RECREAR el tipo con la lista previa
-- (texto/plantilla/otro/ubicacion), renombrando el actual a `_old`, creando el nuevo, recasteando
-- la columna consumidora y soltando el viejo. Patron identico al down de la feature 121
-- (20260724120000_chat_mensaje_ubicacion/down.sql) y al de la 106.
--
-- PRECONDICION SEGURA: NINGUNA fila de "chat_mensaje" con tipo IN ('imagen','audio','video',
-- 'documento','sticker','reaccion','contactos','sistema'). Si quedara alguna, el USING del ALTER
-- COLUMN falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback aborta:
-- comportamiento CORRECTO — revertir borrando mensajes ya recibidos del cliente no es seguro sin
-- intervencion explicita; primero se borran o reasignan esas filas.
--
-- PERDIDA DE DATOS, declarada sin rodeos: soltar las nueve columnas BORRA el identificador de
-- media, los contactos compartidos y la evidencia del cambio de numero de todos los mensajes
-- ingeridos desde que la migracion se aplico. El binario nunca estuvo aqui (D1/R15), asi que lo
-- que se pierde es la referencia; a los 30 dias Meta tampoco lo tendria.
--
-- NO se tocan RLS ni policies (la migracion tampoco las toco). La UNICA columna que usa este
-- enum es "chat_mensaje"."tipo".

-- 3) inverso de (3)
DROP INDEX IF EXISTS "chat_mensaje_reaccion_idx";

-- 2) inverso de (2)
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "sistema_telefono_nuevo";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "sistema_telefono_anterior";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "contactos_json";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "reaccion_emoji";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "reaccion_a_wa_message_id";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "media_tamano_bytes";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "media_nombre";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "media_mime";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "media_id";

-- 1) inverso de (1)
ALTER TYPE "chat_mensaje_tipo" RENAME TO "chat_mensaje_tipo_old";
CREATE TYPE "chat_mensaje_tipo" AS ENUM ('texto', 'plantilla', 'otro', 'ubicacion');
ALTER TABLE "chat_mensaje"
  ALTER COLUMN "tipo" TYPE "chat_mensaje_tipo"
  USING ("tipo"::text::"chat_mensaje_tipo");
DROP TYPE "chat_mensaje_tipo_old";
