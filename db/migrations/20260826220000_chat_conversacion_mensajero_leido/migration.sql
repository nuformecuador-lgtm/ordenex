-- INDICADOR DE MENSAJES SIN LEER DEL CHAT DEL MENSAJERO. El chat flotante de "Mis
-- asignaciones" tiene que mostrar un numero por conversacion con entrantes que el mensajero
-- todavia no ha visto. Para eso hace falta persistir HASTA DONDE leyo cada hilo.
--
-- POR QUE UNA MARCA DE TIEMPO Y NO UN CONTADOR. Un contador ("3 sin leer") hay que
-- incrementarlo en el webhook y decrementarlo al abrir: dos escrituras que compiten y que se
-- desincronizan en cuanto una falla. La marca es IDEMPOTENTE: el no leido se DERIVA
-- (`entrantes con ocurrido_at > mensajero_leido_at`), abrir el hilo dos veces da lo mismo, y
-- el webhook de entrada no toca esta columna para nada.
--
-- POR QUE NULLABLE Y NO `NOT NULL DEFAULT now()`. NULL significa "nunca abrio este hilo", que
-- NO es lo mismo que "lo abrio en el instante del despliegue". Con un DEFAULT `now()` el
-- backfill marcaria como leidos los entrantes ya pendientes de todos los mensajeros vivos, que
-- es justo el aviso que esta feature existe para dar. NULL los deja contando, como debe ser.
ALTER TABLE "chat_conversacion"
  ADD COLUMN "mensajero_leido_at" TIMESTAMP(3);

-- El conteo recorre los entrantes del hilo por `ocurrido_at`; ya lo cubre
-- `chat_mensaje_conversacion_id_ocurrido_at_idx` (creado en `20260723140000_chat_whatsapp`).
-- El scope por mensajero lo cubre `chat_conversacion_mensajero_id_idx`. No hace falta indice
-- nuevo: esta migracion es SOLO la columna.
