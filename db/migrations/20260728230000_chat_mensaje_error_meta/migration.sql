-- Diagnostico de salientes fallidos de WhatsApp. Migracion ADITIVA: no altera ni elimina
-- ninguna tabla, columna ni enum preexistente.
--
-- POR QUE: cuando Meta reporta un saliente como `failed` por webhook, el payload trae un
-- array `errors: [{ code, title, message, error_data: { details } }]` con la razon exacta
-- (destinatario fuera de la lista de permitidos, plantilla no aprobada, limite de cuota...).
-- El borde tipado (`lib/types/whatsapp-webhook.ts`) hacia zod strip de ese array, asi que el
-- motivo se perdia y un fallo quedaba como un `failed` mudo, imposible de diagnosticar sin
-- entrar al panel de Meta.
--
-- Las tres columnas son NULLABLE y solo se pueblan en salientes fallidos: los entrantes y
-- los salientes en cualquier otro estado las dejan en NULL.
--
-- PRIVACIDAD: `error_detalle` guarda el texto que Meta redacta sobre el ERROR (p. ej.
-- "Message failed to send because more than 24 hours have passed..."), nunca el numero
-- destino ni el cuerpo del mensaje, que ya viven en sus propias columnas.
ALTER TABLE "chat_mensaje"
  ADD COLUMN "error_codigo"  INTEGER,
  ADD COLUMN "error_titulo"  TEXT,
  ADD COLUMN "error_detalle" TEXT;

-- Diagnostico operativo: "dame los fallos recientes y por que". Parcial sobre los que
-- tienen codigo (los unicos que interesan), para no indexar toda la tabla.
CREATE INDEX "chat_mensaje_error_codigo_idx"
  ON "chat_mensaje" ("error_codigo", "ocurrido_at" DESC)
  WHERE "error_codigo" IS NOT NULL;
