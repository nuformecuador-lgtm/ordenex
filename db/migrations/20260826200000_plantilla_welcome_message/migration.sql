-- MENSAJE DE BIENVENIDA: una plantilla de `plantilla_mensaje` puede quedar marcada como la
-- que se envia automaticamente cuando el paquete es recogido. Como mucho UNA a la vez.
--
-- POR QUE `NOT NULL DEFAULT false` Y NO NULLABLE. El campo responde a una pregunta cerrada
-- ("¿es esta la de bienvenida?") que toda fila puede contestar hoy: las que ya existen no lo
-- son. Un `NULL` anadiria un tercer valor ("no se sabe") que no significa nada distinto de
-- `false` y obligaria a cada lector a tratarlo. El backfill es el propio DEFAULT.
ALTER TABLE "plantilla_mensaje"
  ADD COLUMN "welcome_message" BOOLEAN NOT NULL DEFAULT false;

-- LA INVARIANTE "solo una en true" LA GUARDA LA BASE, no el codigo de aplicacion. Un UNIQUE
-- PARCIAL sobre una columna constante (`welcome_message`) admite cuantas filas se quiera en
-- `false` y como mucho UNA en `true`: dos sesiones marcando plantillas distintas a la vez no
-- pueden dejar dos bienvenidas, porque la segunda choca contra el indice.
--
-- `deleted_at IS NULL` ENTRA EN EL PREDICADO a proposito: el modulo usa SOFT DELETE (R27), asi
-- que sin eso una plantilla borrada se quedaria reservando el flag para siempre y nadie podria
-- volver a marcar una bienvenida sin resucitarla. Contrapartida asumida: la fila borrada
-- conserva su `true` historico y toda lectura del mensaje de bienvenida DEBE filtrar vigentes.
--
-- Prisma no expresa indices parciales: por eso va a mano aqui y el schema solo lo documenta.
-- Precedente exacto: `jobs_dedupe_key_key` en `20260717120000_jobs_cola`.
CREATE UNIQUE INDEX "plantilla_mensaje_welcome_message_key"
  ON "plantilla_mensaje" ("welcome_message")
  WHERE "welcome_message" = true AND "deleted_at" IS NULL;
