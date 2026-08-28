# Feature 316 — El mensajero puede ENVIAR imagen, vídeo, nota de voz y documentos por el chat

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..R32`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito es testeable y está mapeado a un test
> concreto con ruta y assert en `tasks.md`. Un requisito sin test es un fallo de la feature
> (`CLAUDE.md` §4).

## Contexto y alcance

La feature 311 dejó el ENTRANTE completo (imagen, audio, vídeo, documento, sticker, reacciones,
contactos, cambio de número) y declaró el saliente **fuera de alcance por escrito**
(`specs/311-chat-media-reacciones-contactos/requirements.md:18-21`). Hoy el mensajero solo puede
mandar TEXTO: el `<form>` de `app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx`
(líneas ~455-509) tiene un `<textarea maxLength={4096}>` y un botón `Send`, sin clip ni input de
archivo.

Esta feature añade el ENVÍO. Es la continuación natural de la 311 y **hereda sus decisiones sin
reabrirlas**, en particular **D1/R15 de la 311: no se almacena binario propio**.

**Dentro de alcance:** adjuntar y enviar al cliente desde el chat del mensajero (a) foto o vídeo
tomados con la cámara, (b) un archivo elegido de la galería/almacenamiento, (c) una nota de voz
grabada en el navegador, y (d) documentos PDF, Word (.doc/.docx) y Excel (.xls/.xlsx); persistir
el saliente con su identificador de media y pintarlo en el hilo con el proxy autenticado que ya
existe.

**Fuera de alcance (declarado):**

- Enviar **stickers**, **reacciones**, **ubicación** y **contactos** salientes.
- **Plantillas con cabecera de media** (enviar un adjunto FUERA de la ventana de 24 h). Fuera de
  ventana Meta no acepta media libre y esta feature no la envía (R2/R3).
- **Más de un adjunto por envío** (un adjunto por mensaje, como WhatsApp).
- **Transcodificación de VÍDEO y de AUDIO** en el navegador. (La normalización de IMAGEN sí entra:
  R29–R32. El mismo camino de `<canvas>` **no** sirve para vídeo —recomprimirlo exigiría
  re-codificar fotograma a fotograma con `MediaRecorder`, en tiempo real y con pérdida—, así que
  un vídeo por encima del límite se rechaza tras grabarlo, ver R10.)
- **Recorte y rotación manual** de la imagen por parte del mensajero.
- **Almacenamiento propio del binario** en cualquier forma (mantiene D1/R15 de la 311).
- **Sniffing del contenido del archivo** (validar los bytes contra el MIME declarado). La
  política de SERVIDO de la 311 (`lib/config/chat-media.ts` + `nosniff` + lista de incrustables)
  sigue siendo la que protege al mensajero al pintar el adjunto.
- **Cambios en el proxy `/api/chat/media/[mensajeId]`, en su autorización y en el middleware.**
  Se ha verificado que `findMediaParaMensajero` autoriza por `orden.mensajero_asignado_id` y **no
  filtra por dirección**, así que sirve un saliente sin un solo cambio. La guardia 229
  (`PUBLIC_ROUTES` congelada) no se roza porque no hay ruta nueva.
- **Migración de base de datos.** Medido: el enum `ChatMensajeTipo` (`db/schema.prisma:257-273`)
  ya tiene `imagen|audio|video|documento|sticker` y `ChatMensaje` ya tiene
  `mediaId/mediaMime/mediaNombre/mediaTamanoBytes` nullable (`db/schema.prisma:343-346`).
- **Envío optimista.** El adjunto aparece en el hilo cuando el servidor confirma, con el refresco
  que ya hace la UI; no se pinta una burbuja "fantasma" antes de tiempo.

**Decisiones ya cerradas por el humano el 2026-08-28 (NO se reabren; el spec las implementa):**

- **D1 — Formas de adjuntar:** cámara (foto/vídeo), galería/archivo, nota de voz grabada y
  documentos PDF/Word/Excel.
- **D2 — Ventana de 24 h:** la acción de adjuntar se deshabilita con el MISMO criterio que el
  texto libre (`textoLibreHabilitado`). Meta no acepta media fuera de ventana: **se avisa antes,
  no se descubre fallando**.
- **D3 — Almacenamiento:** NO se guarda binario propio. Se sube a Meta, se persiste el
  identificador de media y se sirve por el proxy que ya existe. **Consecuencia aceptada:** a los
  30 días el adjunto propio dirá que ya no está disponible, igual que hoy hacen los entrantes.
- **D4 — Pie de foto:** lo escrito en el textarea viaja como pie del adjunto, en **un solo
  mensaje**, como WhatsApp. Meta admite pie en imagen, vídeo y documento; **no en audio**.
- **D5 — La nota de voz no se degrada (P1 cerrada el 2026-08-28, opción A).** En un dispositivo
  que no soporte ningún formato de audio aceptado por Meta, la nota de voz **no se ofrece**, con
  aviso explícito (R15). No se envía como documento: es preferible que el mensajero use otra vía
  a que el cliente reciba algo que no puede escuchar.
- **D6 — Tope propio de 25 MB para documentos (P3 cerrada el 2026-08-28).** Por debajo de los
  100 MB que admite Meta, porque quien sube es un repartidor por red móvil: 100 MB tardan minutos
  y agotan el timeout antes de llegar. Los demás límites se quedan en los de Meta (R10).
- **D7 — Se soporta iPhone (P2 cerrada el 2026-08-28).** Rechazar una foto HEIC con un aviso
  equivaldría a rechazar la cámara del teléfono, que es el gesto principal de la feature. La
  imagen se normaliza a JPEG **en el navegador** antes de subirla (R29–R32).
- **D8 — Vídeo por encima del límite (P4 cerrada el 2026-08-28).** Se avisa del límite ANTES de
  abrir la cámara y el vídeo que se pase de 16 MB se rechaza tras grabarlo (R10). No se
  recomprime.

---

## Composer: adjuntar y enviar

**R1** — CUANDO el mensajero abre la acción de adjuntar del chat, el sistema DEBE ofrecerle las
cuatro vías de D1 —cámara (foto/vídeo), archivo del dispositivo, nota de voz y documento— cada
una identificable por su nombre accesible.

**R2** — MIENTRAS el texto libre esté deshabilitado para ese hilo (mismo criterio que hoy
gobierna el `<textarea>`: `textoLibreHabilitado`), el sistema DEBE mantener DESHABILITADA la
acción de adjuntar y DEBE explicar por qué en texto visible, sin que el mensajero tenga que
intentar el envío para descubrirlo (D2).

**R3** — SI llega una petición de envío de adjunto para un hilo fuera de la ventana de 24 h,
ENTONCES el sistema DEBE rechazarla con un desenlace propio de "fuera de ventana", **sin subir el
binario a Meta**, sin enviar mensaje y sin persistir saliente.

**R4** — CUANDO el mensajero selecciona un archivo o termina una grabación, el sistema DEBE
mostrar, ANTES de enviar, una previsualización o el nombre del adjunto elegido, y DEBE permitir
quitarlo y volver al composer de texto sin haber enviado nada.

**R5** — CUANDO el mensajero envía un adjunto de tipo imagen, vídeo o documento teniendo texto
escrito en el composer, el sistema DEBE enviar UN SOLO mensaje con ese texto como pie del
adjunto, y NO DEBE enviar además un mensaje de texto aparte (D4).

**R6** — MIENTRAS el adjunto sea una nota de voz, el sistema NO DEBE enviar pie (Meta no lo admite
en audio) y NO DEBE descartar el texto que el mensajero tuviera escrito: tras enviar la nota, ese
texto DEBE seguir en el composer.

**R7** — MIENTRAS un envío con adjunto esté en curso, el sistema NO DEBE permitir lanzar un
segundo envío del mismo adjunto (ni por doble pulsación ni por la tecla de envío).

## Validación de tipo y tamaño

**R8** — El sistema DEBE aceptar para envío únicamente los tipos de contenido de su lista blanca
de SUBIDA —que incluye PDF, Word (.doc/.docx) y Excel (.xls/.xlsx)— y DEBE derivar de ese tipo de
contenido el tipo del mensaje (imagen, vídeo, audio o documento) con el que se envía y se
persiste.

**R9** — SI el archivo a enviar tiene un tipo de contenido que no está en la lista blanca de
subida —y no es una imagen que la normalización de R29 haya dejado dentro de ella—, ENTONCES el
sistema DEBE rechazarlo con un aviso explícito que diga que ese tipo no se puede enviar, **sin
subir nada a Meta**, sin enviar mensaje y sin persistir saliente.

**R10** — SI el archivo a enviar supera el límite de tamaño aplicable a su tipo —imagen 5 MB,
audio 16 MB, vídeo 16 MB (los tres, los de Meta) y documento **25 MB** (tope propio, más
restrictivo que los 100 MB de Meta, D6)—, ENTONCES el sistema DEBE rechazarlo con un aviso que
indique el límite aplicable, **sin subir nada a Meta**, sin enviar mensaje y sin persistir
saliente. Y CUANDO el mensajero va a grabar un vídeo con la cámara, el sistema DEBE avisar del
límite ANTES de abrirla (D8).

**R11** — El sistema DEBE aplicar las comprobaciones de R9 y R10 **dos veces**: en el navegador
antes de gastar la red del mensajero, y otra vez en el servidor. La comprobación del servidor NO
DEBE depender de ningún dato calculado o declarado por el cliente distinto del propio binario y
su tipo de contenido: una petición fabricada que declare un tamaño falso DEBE ser rechazada
igual.

**R12** — SI el pie de foto supera el máximo de caracteres que admite un pie de adjunto, ENTONCES
el sistema DEBE rechazar el envío antes de subir el binario; y la interfaz DEBE impedir escribir
por encima de ese máximo mientras haya un adjunto seleccionado.

## Normalización de imagen en el navegador — soporte iPhone (D7)

> Estos cuatro requisitos son la razón por la que una foto de iPhone se puede enviar. Van
> numerados a continuación de los 28 originales para no romper la trazabilidad ya establecida;
> se aplican ANTES de R9 y de R10.

**R29** — CUANDO el mensajero elige o toma una IMAGEN cuyo tipo de contenido no está en la lista
blanca de subida (por ejemplo `image/heic` de un iPhone o `image/webp`), el sistema DEBE
convertirla a JPEG en el navegador antes de subirla y DEBE subir el resultado de esa conversión.
NO DEBE subir el archivo original, NO DEBE rechazar la imagen por su tipo original, y NO DEBE
saltarse la conversión por ningún atajo de tamaño: una imagen pequeña fuera de la lista blanca
DEBE convertirse igual. La conversión aplica SOLO a imágenes: vídeo, audio y documentos se envían
tal cual y se rigen por R9/R10.

**R30** — CUANDO el sistema convierte una imagen, DEBE conservar la orientación que indican los
metadatos de la foto (una foto tomada en vertical no puede llegar girada al cliente), y DEBE
aplicar el límite de tamaño de R10 al RESULTADO de la conversión, no al archivo original: una
foto de 8 MB que tras convertir pesa 1 MB DEBE enviarse.

**R31** — SI la conversión de la imagen no se puede completar (el navegador no puede decodificar
el archivo, o no produce un resultado utilizable), ENTONCES el sistema DEBE rechazar el envío con
un aviso propio y explícito de que **la foto no se pudo preparar** —distinguible del aviso de
"tipo no permitido" de R9—, y NO DEBE subir el archivo original.

**R32** — DONDE una imagen ya está en la lista blanca pero supera el límite de su tipo, el sistema
DEBE aplicarle la misma conversión antes de decidir, y solo DEBE rechazarla por tamaño (R10) si
sigue superando el límite DESPUÉS de convertir.

## Nota de voz

**R13** — CUANDO el mensajero graba una nota de voz, el sistema DEBE permitirle detener la
grabación, escucharla antes de enviarla y descartarla sin enviar nada.

**R14** — El sistema DEBE **medir** en el dispositivo, con `MediaRecorder.isTypeSupported`, cuál
de los formatos de audio que Meta acepta está disponible, y DEBE grabar en el primero disponible
de esa lista. NO DEBE asumir el formato por defecto del navegador ni enviar como audio un formato
que Meta no acepta (Chrome en Android graba `audio/webm;codecs=opus`, que Meta rechaza).

**R15** — SI ningún formato de audio aceptado por Meta está soportado por el dispositivo,
ENTONCES el sistema NO DEBE grabar ni ofrecer la nota de voz en ese dispositivo, y DEBE decir en
texto visible que la nota de voz no está disponible ahí, ofreciendo las otras vías de adjuntar.
*(P1 CERRADA por el humano el 2026-08-28, opción A = esta. La alternativa evaluada y descartada
era enviarla como documento `.webm`: llegaría siempre, pero el cliente recibiría un archivo que su
WhatsApp puede no reproducir y el mensajero creería haber mandado una nota de voz. Ver D5.)*

**R16** — SI el navegador deniega el permiso de micrófono o de cámara, o el dispositivo no expone
el medio, ENTONCES el sistema DEBE decirlo explícitamente y volver al composer, y NO DEBE quedarse
en un estado de "grabando" del que no se pueda salir.

## Envío y persistencia

**R17** — CUANDO el envío de un adjunto es válido y está dentro de la ventana, el sistema DEBE
subir el binario a Meta, obtener su identificador de media y enviar el mensaje referenciando ese
identificador; y DEBE persistir el saliente en el hilo con su tipo (imagen/vídeo/audio/documento),
su identificador de media, su tipo de contenido, su nombre de archivo cuando aplique y su tamaño.

**R18** — El sistema NO DEBE almacenar el binario del adjunto en ningún almacenamiento propio
(ni Supabase Storage, ni disco, ni base de datos): DEBE persistir únicamente el identificador de
media y sus metadatos (D3, mantiene R15 de la 311).

**R19** — SI la SUBIDA del binario a Meta falla, ENTONCES el sistema NO DEBE enviar ningún mensaje
ni persistir ningún saliente, DEBE informar del fallo al mensajero y DEBE dejar el adjunto todavía
seleccionado en el composer para que pueda reintentar a mano.

**R20** — SI el ENVÍO del mensaje falla después de una subida correcta —por cualquier causa,
pasajera o determinista—, ENTONCES el sistema DEBE persistir el saliente como fallido con su
motivo y con su identificador de media, y NO DEBE encolar un reintento automático: el
identificador de media caduca en Meta y no existe copia propia del binario para volver a subirlo
(D3/R18).

**R21** — MIENTRAS exista un saliente cuyo tipo sea de adjunto, el reintento automático de envíos
NO DEBE reenviarlo como texto libre. *(Hoy `reintentarEnvio` bifurca solo entre plantilla y
"todo lo demás", y "todo lo demás" se reenvía con `enviarTexto`: un saliente de media enviaría el
pie como un mensaje de texto distinto del que el mensajero mandó.)*

## Hilo y burbuja

**R22** — CUANDO un adjunto se envía con éxito, el sistema DEBE mostrarlo en el hilo como burbuja
SALIENTE con su adjunto y con los acuses de entrega que ya tienen los salientes de texto, sin
recargar la página.

**R23** — MIENTRAS se pinte un adjunto en el hilo, el texto alternativo y el nombre accesible del
adjunto DEBEN corresponder a la DIRECCIÓN del mensaje: un adjunto propio NO DEBE anunciarse como
enviado por el cliente.

**R24** — CUANDO la interfaz pide el binario de un adjunto SALIENTE, el sistema DEBE servirlo por
la misma ruta autenticada que ya sirve los entrantes, con la misma autorización (la orden debe
estar asignada al mensajero de la sesión), y NO DEBE exponer el identificador de media de Meta en
el contrato que consume la interfaz.

**R25** — SI el binario de un adjunto propio ya no está en Meta (caducado a los 30 días o
inexistente), ENTONCES la burbuja saliente DEBE decir explícitamente que el archivo ya no está
disponible, igual que hace hoy la burbuja entrante (D3, hereda R24 de la 311).

## Autorización, seguridad y PII

**R26** — SI la petición de envío de adjunto llega sin sesión válida, ENTONCES el sistema DEBE
rechazarla sin subir el binario, sin llamar a la Graph API y sin persistir nada.

**R27** — SI la petición de envío de adjunto llega de un usuario autenticado cuya sesión NO
corresponde al mensajero asignado de la orden, ENTONCES el sistema DEBE rechazarla sin subir el
binario, sin llamar a la Graph API y sin persistir nada (misma puerta que `enviarMensajeChat`:
`OrdenEnvioReader.findParaEnvio`).

**R28** — El sistema NO DEBE registrar en logs, en ninguna rama (éxito o error) de la acción, del
servicio ni de los clientes de la Graph API: el binario o parte de él, el nombre del archivo, el
número de teléfono del cliente, el pie del adjunto ni el token de WhatsApp (consistente con R35
de la 311 y R11 de la 109).

---

## Trazabilidad

Cada `R<n>` tiene su test —con ruta de archivo y el assert que lo prueba— listado en `tasks.md`.
Un requisito sin test es un fallo de la feature.

## Decisiones cerradas en la puerta (antes preguntas abiertas)

Las cuatro preguntas del borrador las resolvió el humano el 2026-08-28. Se dejan anotadas con su
desenlace para que la decisión no se pierda:

- **P1 → CERRADA, opción (A).** Sin formato de audio aceptado por Meta, no se ofrece la nota de
  voz, con aviso explícito. → **D5 / R15**, sin cambios respecto al borrador. Desbloquea la
  implementación de la nota de voz.
- **P2 → CERRADA, cambia el alcance: «es necesario soportar iPhone».** Rechazar la foto HEIC con
  un aviso ya no vale. → **D7 / R29–R32** (normalización a JPEG en el navegador).
- **P3 → CERRADA: tope propio de 25 MB para documentos**, por la red móvil del repartidor. →
  **D6 / R10**.
- **P4 → CERRADA como estaba:** aviso del límite antes de abrir la cámara y rechazo del vídeo de
  más de 16 MB tras grabarlo; el vídeo NO se recomprime. → **D8 / R10** y "Fuera de alcance".

## Preguntas abiertas

Solo queda lo que **no se puede cerrar con datos del repo** (`CLAUDE.md` §6). No bloquea la
implementación: el diseño de R29–R32 **no depende de que el supuesto sea cierto**, porque
normaliza igual venga JPEG o venga HEIC.

- **S1 — SUPUESTO A MEDIR (afecta al mensaje de ayuda de la UI, no al comportamiento).** Se
  asume, sin poder verificarlo aquí, que **en iOS un `<input type="file" accept="image/*">` con
  `capture` suele entregar JPEG ya transcodificado por Safari**, y que el `.heic` original aparece
  sobre todo por la vía de "Examinar/Files". **No hay en este repo ninguna medición de
  `File.type` en un iPhone real**, ni ningún dispositivo iOS en el arnés de tests, así que esto se
  declara como supuesto y NO como hecho.
  - **Cómo se mide, cuando haya un iPhone delante:** abrir el chat, adjuntar por cada una de las
    dos vías (cámara y "Examinar") y registrar `archivo.type` y `archivo.size` del `File`
    resultante en un `console.warn` temporal o en el `toast` de error; anotar ambos valores y la
    versión de iOS en `progress/current.md`.
  - **Por qué no bloquea:** si el supuesto es cierto, la conversión de R29 no se dispara casi
    nunca en iOS (`image/jpeg` ya está en la lista blanca) y el coste es cero; si es falso, se
    dispara y la foto se envía igual. Lo único que cambia según la medición es cuánta batería y
    memoria gasta el camino de conversión en un iPhone, y si conviene mencionar la vía "Examinar"
    en el texto de ayuda.
