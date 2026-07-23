-- Feature 109 (design §1): chat del mensajero con el cliente via WhatsApp. Crea:
-- (1) 3 enums nativos (chat_mensaje_direccion / chat_mensaje_tipo / chat_mensaje_estado).
-- (2) Tabla `chat_conversacion` (hilo por orden+numero, R13): FK a orden (RESTRICT) y a
--     usuario/mensajero (RESTRICT), unico (orden_id, telefono_e164) (D4), indices de scope
--     (mensajero_id, R16) y de resolucion del entrante (telefono_e164, R25).
-- (3) Tabla `chat_mensaje` (R14): direccion/tipo enums, cuerpo nullable, FK a
--     chat_conversacion (CASCADE) y a plantilla_mensaje (SET NULL). Indice UNICO PARCIAL
--     sobre wa_message_id (WHERE wa_message_id IS NOT NULL) para el dedupe (R8) y localizar
--     el saliente al llegar un status (R7); Prisma no expresa indice parcial -> va a mano
--     aqui (patron wallet_movimiento). Indice (conversacion_id, ocurrido_at) para el
--     historial ordenado (R22).
-- RLS habilitada SIN policies en ambas tablas (solo service role), patron
-- plantilla_mensaje / wallet_movimiento / gestion_orden: la autorizacion de negocio
-- (scope por mensajero, R16) vive en el service (R15). Migracion ADITIVA: no altera ni
-- borra tablas existentes.

-- 1) enums nativos.
CREATE TYPE "chat_mensaje_direccion" AS ENUM ('entrante', 'saliente');

CREATE TYPE "chat_mensaje_tipo" AS ENUM ('texto', 'plantilla', 'otro');

CREATE TYPE "chat_mensaje_estado" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- 2) tabla chat_conversacion (hilo). ultimo_entrante_at nullable (NULL = sin entrantes).
CREATE TABLE "chat_conversacion" (
  "id" TEXT NOT NULL,
  "telefono_e164" TEXT NOT NULL,
  "orden_id" TEXT NOT NULL,
  "mensajero_id" TEXT NOT NULL,
  "ultimo_entrante_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_conversacion_pkey" PRIMARY KEY ("id")
);

-- FK a orden (RESTRICT: no huerfanos) y a usuario/mensajero (RESTRICT).
ALTER TABLE "chat_conversacion" ADD CONSTRAINT "chat_conversacion_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_conversacion" ADD CONSTRAINT "chat_conversacion_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D4: un hilo por (orden, numero). R16: scope por mensajero. R25: resolucion del entrante.
CREATE UNIQUE INDEX "chat_conversacion_orden_id_telefono_e164_key"
  ON "chat_conversacion"("orden_id", "telefono_e164");
CREATE INDEX "chat_conversacion_mensajero_id_idx" ON "chat_conversacion"("mensajero_id");
CREATE INDEX "chat_conversacion_telefono_e164_idx" ON "chat_conversacion"("telefono_e164");

-- 3) tabla chat_mensaje. estado nullable (solo salientes, R7). cuerpo nullable.
CREATE TABLE "chat_mensaje" (
  "id" TEXT NOT NULL,
  "conversacion_id" TEXT NOT NULL,
  "direccion" "chat_mensaje_direccion" NOT NULL,
  "tipo" "chat_mensaje_tipo" NOT NULL,
  "cuerpo" TEXT,
  "plantilla_id" TEXT,
  "wa_message_id" TEXT,
  "estado" "chat_mensaje_estado",
  "ocurrido_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_mensaje_pkey" PRIMARY KEY ("id")
);

-- FK a chat_conversacion (CASCADE: borrar el hilo borra sus mensajes) y a plantilla
-- (SET NULL: borrar la plantilla no borra el mensaje ya enviado).
ALTER TABLE "chat_mensaje" ADD CONSTRAINT "chat_mensaje_conversacion_id_fkey"
  FOREIGN KEY ("conversacion_id") REFERENCES "chat_conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_mensaje" ADD CONSTRAINT "chat_mensaje_plantilla_id_fkey"
  FOREIGN KEY ("plantilla_id") REFERENCES "plantilla_mensaje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- R8/R7: dedupe por wa_message_id. Indice UNICO PARCIAL (solo cuando NO es NULL: los
-- salientes que aun no tienen id de Meta -p. ej. `queued`- quedan fuera y no colisionan
-- entre si). Prisma no expresa indice parcial -> va a mano (patron wallet_movimiento).
CREATE UNIQUE INDEX "chat_mensaje_wa_message_id_key"
  ON "chat_mensaje"("wa_message_id")
  WHERE "wa_message_id" IS NOT NULL;

-- R22: historial ordenado cronologicamente dentro de un hilo.
CREATE INDEX "chat_mensaje_conversacion_id_ocurrido_at_idx"
  ON "chat_mensaje"("conversacion_id", "ocurrido_at");

-- R15: RLS habilitada SIN policies (solo service role), patron plantilla_mensaje /
-- wallet_movimiento. La autorizacion de negocio (scope por mensajero, R16) vive en el service.
ALTER TABLE "chat_conversacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_mensaje" ENABLE ROW LEVEL SECURITY;
