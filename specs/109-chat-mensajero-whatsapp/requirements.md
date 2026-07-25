# Feature 109 — Chat del mensajero con el cliente vía WhatsApp (webhook de entrada)

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..Rn`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito debe ser testeable y
> mapeable a un test concreto (ver `tasks.md`).

## Contexto y alcance

Chat 1:1 entre el **mensajero** y el **cliente destinatario de una orden**, usando
WhatsApp Cloud API como canal. El mensajero escribe desde `app/(app)/mis-asignaciones/`;
el sistema envía por WhatsApp reutilizando `WhatsappCloudClient`
(`lib/clients/whatsapp-cloud.ts`) y `loadWhatsappConfig` (`lib/config/whatsapp.ts`). Las
**respuestas del cliente entran por un webhook de entrada NUEVO** y quedan registradas en
el hilo. El núcleo nuevo de esta feature es: (a) el webhook de entrada firmado, (b) las
tablas de conversación y mensaje de chat con RLS, (c) el envío saliente desde la UI con la
regla de la ventana de 24 h, y (d) la UI del hilo.

Fuera de alcance: gestión/CRUD de plantillas (feature 107, ya existente y reutilizada);
notificaciones push; adjuntos multimedia entrantes salvo su registro mínimo como tipo.

---

## Webhook de entrada — verificación (handshake)

**R1** — CUANDO el endpoint del webhook recibe una petición `GET` cuyos parámetros
cumplen `hub.mode = "subscribe"` Y `hub.verify_token` es exactamente igual al secreto de
verificación configurado en entorno, el sistema DEBE responder `200` con el valor de
`hub.challenge` en el cuerpo como texto plano, sin envoltura JSON.

**R2** — SI una petición `GET` al webhook NO cumple `hub.mode = "subscribe"`, O
`hub.verify_token` no coincide con el secreto, O falta cualquiera de esos parámetros,
ENTONCES el sistema DEBE responder `403` y NO DEBE devolver el `challenge`.

## Webhook de entrada — firma e ingestión (POST)

**R3** — CUANDO el endpoint recibe una petición `POST`, el sistema DEBE verificar la
cabecera `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el App Secret configurado)
ANTES de procesar o persistir cualquier dato.

**R4** — SI la cabecera `X-Hub-Signature-256` falta O su firma no coincide con el HMAC
calculado sobre el cuerpo crudo, ENTONCES el sistema DEBE responder `401` (o `403`) y NO
DEBE persistir ningún dato ni producir efectos secundarios.

**R5** — CUANDO la firma es válida, el sistema DEBE validar el cuerpo con un esquema (zod)
que descarta (strip) los campos no reconocidos antes de procesarlo.

**R6** — CUANDO un `POST` con firma válida contiene mensajes ENTRANTES del cliente
(`entry[].changes[].value.messages[]`), el sistema DEBE registrar cada mensaje en el hilo
correspondiente con dirección "entrante", su `wa_message_id`, su tipo, su cuerpo/texto (si
lo trae) y su marca de tiempo.

**R7** — CUANDO un `POST` con firma válida contiene actualizaciones de ESTADO de mensajes
salientes (`entry[].changes[].value.statuses[]`), el sistema DEBE actualizar el estado de
entrega del mensaje saliente identificado por su `wa_message_id` al valor recibido
(`sent` / `delivered` / `read` / `failed`).

**R8** — SI un mensaje entrante (o una actualización de estado) trae un identificador de
Meta (`wa_message_id`) ya registrado, ENTONCES el sistema NO DEBE crear un registro
duplicado (idempotencia ante reenvíos de Meta).

**R9** — CUANDO la firma de un `POST` es válida, el sistema DEBE responder `200`
rápidamente aunque un evento individual del lote no se pueda mapear a un hilo (para evitar
reintentos innecesarios de Meta ante eventos no accionables).

**R10** — El endpoint del webhook DEBE ser alcanzable SIN cookie de sesión (su
autenticación es la firma HMAC), es decir, DEBE quedar excluido del guard de sesión de
`middleware.ts`.

**R11** — El sistema NO DEBE registrar en logs el token de WhatsApp, el App Secret, el
secreto de verificación, ni el número de teléfono del cliente ni otro dato personal, en
ninguna rama del webhook (éxito o error).

**R12** — SI falta cualquiera de las variables de entorno requeridas por el webhook
(secreto de verificación y App Secret), ENTONCES el sistema DEBE fallar citando el NOMBRE
de la variable ausente, nunca su valor.

## Persistencia — hilo y mensajes

**R13** — El sistema DEBE mantener un modelo de **conversación/hilo** identificado por el
número de teléfono del cliente en formato E.164, vinculado a la Orden y al mensajero
asignado, que guarde la marca de tiempo del último mensaje ENTRANTE del cliente.

**R14** — El sistema DEBE mantener un modelo de **mensaje de chat** que persista: dirección
(entrante/saliente, como enum Postgres nativo), tipo (texto/plantilla/otros), cuerpo/texto,
`wa_message_id` (único, para dedupe), marca de tiempo, y —para salientes— el estado de
entrega (`queued`/`sent`/`delivered`/`read`/`failed`).

**R15** — Las tablas nuevas DEBEN tener Row Level Security habilitada, y la migración que
las crea DEBE incluir su `down.sql` que revierte exactamente la migración.

**R16** — MIENTRAS un mensajero consulta o responde el chat, el sistema DEBE exponerle
únicamente los hilos correspondientes a órdenes asignadas a ese mensajero (scope por
`mensajeroAsignadoId`), y NO los hilos de otros mensajeros.

## Envío saliente desde la UI (Server Action)

**R17** — CUANDO el mensajero envía un mensaje de texto desde el chat, la Server Action DEBE
resolver al actor por sesión y validar que la orden del hilo está asignada a ese mensajero
antes de enviar; SI no lo está, ENTONCES DEBE rechazar sin enviar.

**R18** — MIENTRAS el último mensaje ENTRANTE del cliente en el hilo ocurrió hace menos de
24 horas, el sistema DEBE permitir el envío de texto libre por el `WhatsappCloudClient`.

**R19** — SI el último mensaje entrante del cliente ocurrió hace 24 horas o más (o no
existe ninguno), ENTONCES el sistema NO DEBE enviar texto libre y DEBE requerir el envío de
una plantilla aprobada (reutilizando el flujo de la feature 107).

**R20** — CUANDO un envío saliente devuelve desenlace `ok`, el sistema DEBE persistir el
mensaje saliente en el hilo con su `wa_message_id` devuelto por Meta y estado inicial de
entrega.

**R21** — SI un envío saliente devuelve desenlace `transitorio`, ENTONCES el sistema DEBE
tratarlo como reintentable (no perder el mensaje) y comunicar el desenlace a la UI sin
filtrar secretos ni el número destino.

## UI del chat (rol mensajero, dentro de `mis-asignaciones`)

**R22** — DONDE una asignación tiene un hilo de chat, el sistema DEBE mostrar el historial
de mensajes ordenado cronológicamente, distinguiendo visualmente mensajes entrantes de
salientes y mostrando el estado de entrega de los salientes.

**R23** — MIENTRAS el hilo está dentro de la ventana de 24 h, la UI DEBE habilitar el input
de texto libre; MIENTRAS está fuera de la ventana, la UI DEBE deshabilitar el texto libre y
ofrecer el envío de una plantilla.

**R24** — El sistema DEBE refrescar el hilo mostrado al mensajero para reflejar los mensajes
entrantes nuevos sin recarga manual de la página (mecanismo definido en `design.md`, D5).

## Resolución de la orden desde el número entrante

**R25** — CUANDO llega un mensaje entrante de un número de cliente, el sistema DEBE resolver
la orden/asignación destino a partir del número (regla exacta definida en `design.md`, D4);
SI el número no resuelve a ninguna orden activa asignada, ENTONCES el sistema DEBE registrar
el mensaje de forma que no se pierda pero no rompa el `200` del webhook (R9).

---

## Trazabilidad

Cada `R<n>` anterior tiene su test correspondiente listado en `tasks.md` (unit /
integration / component). Un requisito sin test es un fallo de la feature (regla del arnés,
`CLAUDE.md` §4 y `docs/specs.md` §Trazabilidad).

## Preguntas abiertas

Las decisiones técnicas no resueltas se elevan a la puerta humana (F1.4) y están detalladas
en `design.md` §"Decisiones abiertas para la puerta humana" (D1–D6). Aquí se resumen las que
afectan al comportamiento observable y por tanto a la redacción de estos requisitos:

- **P1 (afecta R16/R25):** ¿qué ocurre exactamente cuando un mismo número de cliente tiene
  varias órdenes activas asignadas (posiblemente a mensajeros distintos)? La regla de
  desempate condiciona a qué hilo se adjunta el mensaje entrante. Ver D4.
- **P2 (afecta R16):** ¿qué otros roles además del mensajero asignado pueden LEER el hilo
  (maestro/admin/tienda)? Ver D3. Mientras no se resuelva, R16 se especifica solo para el
  mensajero asignado.
- **P3 (afecta R19/R23):** fuera de la ventana de 24 h, ¿se BLOQUEA el texto libre por
  completo o se fuerza silenciosamente a plantilla? Ver D2.
- **P4 (afecta R20/R21):** ¿el envío saliente es en línea o encolado en la cola de jobs? El
  comportamiento observable ante `transitorio` (R21) depende de esto. Ver D1.
- **P5 (afecta R24):** mecanismo de refresco (polling / SWR revalidate / realtime). Ver D5.
</content>
</invoke>
