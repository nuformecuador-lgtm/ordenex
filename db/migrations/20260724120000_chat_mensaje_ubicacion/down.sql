-- DOWN de la feature 121 (design §1.2, R7). Revierte EXACTAMENTE el migration.sql:
--   (1) elimina las columnas `latitud`/`longitud` de `chat_mensaje`;
--   (2) recrea el enum `chat_mensaje_tipo` SIN el valor `ubicacion`.
--
-- IRREVERSIBILIDAD PARCIAL DEL ENUM: Postgres NO soporta `ALTER TYPE ... DROP VALUE`. La unica
-- forma de "quitar" `ubicacion` es RECREAR el tipo con la lista previa (texto/plantilla/otro),
-- renombrando el actual a `_old`, creando el nuevo, recasteando la columna consumidora y
-- soltando el viejo. Patron identico al down de la feature 106
-- (20260722130000_cancelacion_api_por_key/down.sql).
--
-- PRECONDICION SEGURA: NINGUNA fila de "chat_mensaje" con tipo = 'ubicacion'. Si quedara
-- alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al tipo
-- recreado y el rollback aborta: comportamiento CORRECTO — revertir borrando ubicaciones ya
-- recibidas del cliente no es seguro sin intervencion explicita; primero se borran/reasignan
-- esas filas.
--
-- Orden: primero DROP de las columnas (son aditivas puras), luego la recreacion del enum. La
-- UNICA columna que usa este enum es "chat_mensaje"."tipo".
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "longitud";
ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "latitud";

ALTER TYPE "chat_mensaje_tipo" RENAME TO "chat_mensaje_tipo_old";
CREATE TYPE "chat_mensaje_tipo" AS ENUM ('texto', 'plantilla', 'otro');
ALTER TABLE "chat_mensaje"
  ALTER COLUMN "tipo" TYPE "chat_mensaje_tipo"
  USING ("tipo"::text::"chat_mensaje_tipo");
DROP TYPE "chat_mensaje_tipo_old";
