# Feature 299 — El chat muestra media, reacciones, contactos y el cambio de número del cliente

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..R35`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito es testeable y está mapeado a un
> test concreto en `tasks.md`. Un requisito sin test es un fallo de la feature (`CLAUDE.md` §4).

## Contexto y alcance

Extiende el chat 1:1 mensajero↔cliente de las features 109/120/121. Hoy, todo entrante que no
sea `text` ni `location` cae en `tipoDeMeta()` a `otro` con `cuerpo = null`
(`lib/types/whatsapp-webhook.ts`) y `ChatConversacion.tsx` lo pinta como `<p>{cuerpo ?? ""}</p>`:
una **burbuja vacía** con solo la hora.

**Dentro de alcance:** entrantes `image`, `audio`, `video`, `document`, `sticker`, `reaction`,
`contacts` y `system` (`user_changed_number`); ver/escuchar/descargar el archivo; y convertir
en enlace las URL que vengan dentro de un texto.

**Fuera de alcance (confirmado por el humano):** `button`, `interactive`, `order`,
`request_welcome`, `ephemeral` y el campo `message_template_status_update`. También queda fuera
el ENVÍO saliente de media desde el mensajero (esta feature es solo de entrada), y cualquier
cambio en la verificación de firma HMAC del webhook (R3/R4 de la 109, intactos).

**Decisiones ya cerradas por el humano (NO se reabren; el spec las implementa):**

- **D1 — Media por proxy bajo demanda, SIN almacenar.** Se persiste el media `id` de Meta más
  sus metadatos; una ruta propia AUTENTICADA baja el binario de la Graph API con el token y lo
  sirve. No hay bucket de Storage, ni cron de purga, ni binario en reposo. El token nunca llega
  al navegador.
- **D2 — Aviso de expiración.** Meta borra el binario a los 30 días; cuando la descarga falle
  por eso, la UI lo dice explícitamente. Es requisito, no cortesía.
- **D3 — Cambio de número.** Se migra el hilo (se reescribe `telefono_e164` de la conversación
  al `wa_id` nuevo) y se deja evidencia persistente del número anterior y el nuevo, visible como
  burbuja de sistema. No se toca el teléfono de la orden ni el del cliente.
- **D4 — Reacciones como en WhatsApp:** pegadas a la burbuja del mensaje al que reaccionan
  (`reaction.message_id`), nunca como burbuja suelta. Emoji vacío = reacción retirada.
- **D5 — Contacts:** se muestran los datos (nombre, teléfonos, email…) y cada dato se puede
  copiar.
- **D6 — URL en texto:** se enlaza SOLO el tramo de la URL, no el mensaje entero.

---

## Ingesta del webhook — normalización de los tipos nuevos

**R1** — CUANDO el webhook recibe (con firma válida, R3/R4 de la 109) un mensaje entrante con
`type` ∈ {`image`, `audio`, `video`, `document`, `sticker`} que trae el identificador de media,
el sistema DEBE normalizarlo a un mensaje entrante de dominio con el tipo propio correspondiente
(imagen, audio, video, documento, sticker) y conservar el identificador de media, su tipo MIME
cuando Meta lo envíe y el nombre de archivo cuando Meta lo envíe (documentos).

**R2** — CUANDO un mensaje entrante de media trae un pie de foto (`caption`), el sistema DEBE
conservar ese texto como cuerpo del mensaje; SI no lo trae, ENTONCES el cuerpo DEBE quedar
vacío (`null`) sin que ello impida registrar el mensaje.

**R3** — SI un mensaje entrante de media NO trae identificador de media utilizable, ENTONCES el
sistema DEBE degradarlo a tipo `otro` sin identificador, DEBE seguir respondiendo `200` al
webhook (R9 de la 109) y NO DEBE lanzar una excepción que anule el lote.

**R4** — CUANDO el webhook recibe un mensaje entrante con `type = "reaction"` que trae el
identificador del mensaje reaccionado y un emoji no vacío, el sistema DEBE normalizarlo a un
mensaje entrante de tipo reacción que conserve el identificador del mensaje reaccionado y el
emoji.

**R5** — CUANDO una reacción llega con el emoji vacío, el sistema DEBE registrarla como
reacción RETIRADA (sin emoji), no como reacción con emoji vacío.

**R6** — SI una reacción NO trae identificador del mensaje reaccionado, ENTONCES el sistema DEBE
degradarla a tipo `otro`, responder `200` y no lanzar.

**R7** — CUANDO el webhook recibe un mensaje entrante con `type = "contacts"`, el sistema DEBE
normalizarlo a un mensaje entrante de tipo contactos que conserve, por cada contacto recibido,
el nombre visible y las listas de teléfonos, correos electrónicos, direcciones, organización y
URLs que Meta envíe, descartando cualquier campo no reconocido.

**R8** — SI un mensaje `type = "contacts"` llega sin ningún contacto utilizable (lista ausente,
vacía o no parseable), ENTONCES el sistema DEBE degradarlo a tipo `otro`, responder `200` y no
lanzar.

**R9** — CUANDO el webhook recibe un mensaje entrante con `type = "system"` cuyo subtipo indica
que el cliente cambió de número —`user_changed_number`, `customer_changed_number` o
`customer_identity_changed`, los tres nombres que ha usado la Cloud API— y del que se puede determinar el número
NUEVO, el sistema DEBE normalizarlo a un mensaje entrante de tipo sistema que conserve el número
ANTERIOR y el número NUEVO. El test DEBE cubrir los TRES subtipos: casar solo contra
`user_changed_number` deja este requisito muerto en `v21.0`, que es la versión del repo.

**R10** — SI un mensaje `type = "system"` no permite determinar el número nuevo (campo ausente o
no utilizable), ENTONCES el sistema NO DEBE migrar ningún hilo, DEBE degradar el mensaje sin
inventar números, DEBE responder `200` y no lanzar.

**R11** — CUANDO el webhook recibe un mensaje entrante de un `type` fuera de alcance (`button`,
`interactive`, `order`, `request_welcome`, `ephemeral`) o desconocido, o con campos que el
sistema no declara, el sistema DEBE seguir registrándolo como tipo `otro`, descartando (strip)
los campos no reconocidos, respondiendo `200` y sin lanzar (R5/R9 de la 109 intactos).

**R12** — CUANDO se ingiere un entrante de cualquiera de los tipos nuevos, el sistema DEBE
mantener el comportamiento de la 109: NO DEBE crear un registro duplicado si su
`wa_message_id` ya está registrado, y un entrante NUEVO (no deduplicado) DEBE sellar la marca
del último entrante del hilo, mientras que uno deduplicado NO DEBE re-sellarla.

## Persistencia

**R13** — El cambio de esquema DEBE añadir al enum de tipos de mensaje los valores nuevos y a
la tabla de mensajes las columnas nullable que sostienen los datos de R1, R2, R4, R5, R7 y R9,
mediante una migración versionada que incluya su `down.sql` reversible.

**R14** — MIENTRAS existan mensajes ya guardados como `otro` por el comportamiento anterior, el
sistema NO DEBE reinterpretarlos ni reconstruirlos (su payload original no se conservó), y la
UI DEBE pintarlos con un aviso legible de mensaje no soportado en lugar de una burbuja vacía.

**R15** — El sistema NO DEBE almacenar el binario de la media en ningún almacenamiento propio
(ni Supabase Storage, ni disco, ni base de datos): DEBE persistir únicamente el identificador de
media y sus metadatos (D1).

## Cambio de número del cliente

**R16** — CUANDO se ingiere un evento de cambio de número con número nuevo determinable y existe
una conversación cuyo `telefono_e164` es el número anterior, el sistema DEBE reescribir ese
`telefono_e164` al número nuevo.

> **LIMITACIÓN CONOCIDA, DECIDIDA POR EL HUMANO EL 2026-08-27 — no es un bug, no la «arregles».**
> La redacción original de R16 prometía además «de modo que los mensajes posteriores del cliente
> caigan en el MISMO hilo». **Eso no ocurre, y la cláusula se retiró por falsa.** Un entrante se
> resuelve a su orden por `orden.telefono_dest` (`ChatConversacionRepository.resolverOrdenActivaPorNumero`),
> NO por el teléfono del hilo; y R17 prohibe tocar ese campo del maestro. Por tanto **un mensaje
> enviado desde el número NUEVO no resuelve ninguna orden**: se cuenta `sinResolver`, el webhook
> responde `200` y el mensaje no llega a nadie (Meta no reintenta un `200`).
>
> Se evaluaron tres salidas —tabla de alias, escribir `orden.telefono_dest`, o dejarlo— y **el
> humano eligió dejarlo como EVIDENCIA**: la migración del hilo y la burbuja de R18 sirven para que
> quede constancia del cambio, no para sostener la conversación. La burbuja **debe decirlo de
> forma explícita** para no sugerir una continuidad que no existe (ver R32).

**R17** — CUANDO el sistema migra un hilo por cambio de número, NO DEBE modificar el teléfono de
la orden ni el del cliente en el maestro de datos (D3).

**R18** — CUANDO el sistema migra un hilo por cambio de número, DEBE dejar en ese hilo evidencia
PERSISTENTE del cambio con el número anterior y el nuevo; y SI el mismo evento se reprocesa o
la migración no es posible (por ejemplo, porque ya existe otro hilo de esa orden con el número
nuevo), ENTONCES el sistema NO DEBE duplicar la evidencia ni romper la ingesta del lote, y DEBE
seguir respondiendo `200`.

## Contrato hacia la UI

**R19** — CUANDO la Server Action que lista el hilo devuelve los mensajes, DEBE exponer por cada
mensaje su tipo y los datos necesarios para pintarlo (presencia de media, tipo MIME, nombre de
archivo, contactos, y números anterior/nuevo del cambio de número), y NO DEBE devolver los
mensajes de tipo reacción como burbujas propias: DEBE devolverlos agregados al mensaje al que
reaccionan (D4).

**R20** — CUANDO un mismo autor reacciona varias veces al mismo mensaje, el sistema DEBE exponer
únicamente la reacción MÁS RECIENTE de ese autor; y SI la más reciente es una retirada (R5),
ENTONCES NO DEBE exponer ninguna reacción de ese autor sobre ese mensaje.

## Ruta proxy de media

**R21** — CUANDO el mensajero al que está asignada la orden solicita la media de un mensaje de
su hilo, el sistema DEBE responder el binario obtenido de la Graph API con el tipo de contenido
correspondiente, sin exponer el identificador de media de Meta ni el token en la respuesta.

**R22** — SI la petición de media llega sin sesión válida, ENTONCES el sistema DEBE rechazarla
sin devolver binario y sin realizar ninguna llamada a la Graph API.

**R23** — SI la petición de media llega de un usuario autenticado cuya sesión NO corresponde al
mensajero asignado de la orden del mensaje, ENTONCES el sistema DEBE responder `403` sin
devolver binario y sin realizar ninguna llamada a la Graph API (misma regla que `listarHilo`,
R16/R17 de la 109).

**R24** — SI la Graph API responde que la media ya no existe (caducada a los 30 días o
eliminada), ENTONCES el sistema DEBE responder con un desenlace propio y distinguible de
"expirado" (no un error genérico), y la UI DEBE mostrar un texto explícito de que el archivo ya
no está disponible, en lugar de un icono roto o un error genérico (D2).

**R25** — CUANDO el mensajero pide DESCARGAR un adjunto, el sistema DEBE servirlo como descarga
con un nombre de archivo saneado; y MIENTRAS el tipo de contenido no pertenezca a la lista de
tipos seguros para incrustar (imagen, audio o vídeo no scriptables), el sistema DEBE forzar la
descarga y DEBE impedir que el navegador adivine el tipo de contenido.

**R26** — La ruta de media DEBE quedar detrás del guard de sesión: NO DEBE añadirse a la lista
de rutas públicas ni a la de rutas con autenticación propia del middleware, de modo que la
guardia que congela esas listas (feature 229) siga en verde sin modificarse.

## UI del hilo

**R27** — MIENTRAS el mensajero mira el hilo, ninguna burbuja DEBE quedar sin contenido
perceptible: todo mensaje de los tipos de esta feature DEBE mostrar un contenido o una etiqueta
que identifique qué mandó el cliente.

**R28** — DONDE un mensaje es de tipo imagen o sticker, la UI DEBE mostrar una previsualización
con texto alternativo; DONDE es de tipo audio o vídeo, DEBE ofrecer un reproductor con controles
y con nombre accesible.

**R29** — DONDE un mensaje es de tipo documento, la UI DEBE mostrar su nombre de archivo (o una
etiqueta genérica si no vino) y ofrecer una acción de descarga.

**R30** — DONDE un mensaje del hilo tiene reacciones, la UI DEBE pintarlas ancladas a la burbuja
de ESE mensaje, y NO DEBE pintar ninguna burbuja suelta para la reacción (D4).

**R31** — DONDE un mensaje es de tipo contactos, la UI DEBE mostrar los datos del contacto
(nombre, teléfonos, correos y demás datos recibidos) y ofrecer, por cada dato, una acción de
COPIAR que al usarse confirme el copiado de forma perceptible sin depender de una animación
(compatible con `prefers-reduced-motion`).

**R32** — DONDE un mensaje es de tipo sistema por cambio de número, la UI DEBE pintarlo como
burbuja de sistema, visualmente distinta de las burbujas entrante/saliente, citando el número
anterior y el nuevo.

## Enlaces dentro de un texto

**R33** — CUANDO un mensaje de texto contiene una o más URL con esquema `http` o `https`, la UI
DEBE renderizar como enlace SOLO el tramo de la URL —el resto del texto permanece como texto
plano— y cada enlace DEBE abrirse en pestaña nueva con `rel="noopener noreferrer"`.

**R34** — El sistema NO DEBE construir el contenido de una burbuja inyectando HTML
(`dangerouslySetInnerHTML`) y NO DEBE convertir en enlace un tramo cuyo esquema no sea `http` ni
`https` (por ejemplo `javascript:`, `data:`, `file:`).

## Seguridad y PII

**R35** — El sistema NO DEBE registrar en logs, en ninguna rama (éxito o error) del webhook, del
service, del cliente de la Graph API ni de la ruta proxy: el número de teléfono del cliente, el
cuerpo del mensaje, las coordenadas, los datos de un contacto compartido, ni el token de
WhatsApp (consistente con R11 de la 109 y R15 de la 121).

---

## Trazabilidad

Cada `R<n>` tiene su test listado en `tasks.md` (unit / integration / component). Un requisito
sin test es un fallo de la feature.

## Preguntas abiertas

Las decisiones de comportamiento observable están cerradas (D1–D6). Quedan estos puntos, que NO
se han supuesto en el diseño y que el humano debería resolver en la puerta de aprobación:

- **P1 (afecta R9/R10) — campo del número nuevo.** La forma del mensaje `system` ha variado
  entre versiones de la Cloud API (`system.wa_id`, `system.new_wa_id`, `system.customer`) y el
  arnés NO tiene un payload real capturado en este repo. **RESUELTA EN LA PUERTA (2026-08-27):**
  se mantiene la cascada tolerante (primer campo disponible; `messages[].from` como anterior) y
  se amplía el subtipo aceptado a los tres nombres históricos (ver R9), porque el borrador
  casaba solo contra `user_changed_number` y el repo apunta a `v21.0`, donde el evento no se
  llama así. **SIGUE SIN MEDIRSE:** en cuanto se capture un payload real en producción hay que
  confirmar el campo exacto contra lo medido, no contra la tolerancia, y anotarlo en
  `progress/current.md`.
- **P2 (afecta R1/R19) — tamaño del archivo.** El webhook de Meta no envía el tamaño del binario
  (solo `id`, `mime_type`, `sha256` y, en documentos, `filename`); el tamaño solo se conoce al
  descargarlo. El diseño deja la columna de tamaño nullable, poblada solo si Meta la manda, y la
  UI muestra el tamaño únicamente cuando se conoce. ¿Es aceptable ver "tamaño desconocido" antes
  de abrir el archivo?
- **P3 (afecta R21/R28) — cuándo se baja el binario.** El diseño carga automáticamente imágenes y
  stickers al pintar el hilo, y deja audio, vídeo y documentos bajo acción explícita del
  mensajero ("Reproducir" / "Descargar"), para no consumir datos móviles ni cuota de la Graph
  API en cada refresco de 10 s. ¿Se confirma ese reparto?
- **P4 (afecta R20) — autoría de la reacción.** El hilo es 1:1 con un único cliente, así que en
  la práctica el autor de una reacción entrante es siempre ese cliente. R20 se especifica "por
  autor" para no cerrar la puerta a reacciones salientes futuras; si el humano prefiere la regla
  simple ("una reacción por mensaje, la última gana"), se simplifica el agregado.
- **P5 (afecta R18) — colisión al migrar el hilo.** Si ya existe una conversación de la MISMA
  orden con el número nuevo, el diseño no fusiona hilos (no rompe, deja evidencia y sigue). ¿Se
  acepta esa degradación o el humano quiere fusión de hilos en una feature aparte?
