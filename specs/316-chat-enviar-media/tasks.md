# Feature 316 — Tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con sus hermanos del mismo
> bloque. Cada task lleva su criterio de "hecho" **en forma de `assert`**, nunca "existe el
> archivo" ni "hay un comentario" (un criterio tipo `grep` se satisface reescribiendo el
> comentario que documenta la trampa). Al final va el mapa **R→test**: un requisito sin test hace
> que el reviewer rechace (`CLAUDE.md` §4).
>
> **Antes de empezar:** el spec tiene que pasar la puerta humana (`spec_ready` → "aprobado").
> Las cuatro preguntas del borrador (P1–P4) están **CERRADAS** por el humano el 2026-08-28
> (ver `requirements.md > Decisiones cerradas en la puerta`): nada bloquea el bloque E. Lo único
> abierto es **S1**, un supuesto a medir en un iPhone real que **no condiciona el código**.
>
> **No hay bloque de migración.** Verificado en `db/schema.prisma:257-273` y `:343-346`
> (design §1). La task A0 lo convierte en un assert para que nadie lo dé por bueno leyendo.

## Bloque A — Cimientos: política de subida y contrato de escritura

- [x] **A0.** Fijar con un test que **no hace falta migración**: el enum `ChatMensajeTipo` acepta
  los cuatro tipos de adjunto y `ChatMensaje` tiene las cuatro columnas `media*` nullable.
  Cubre la premisa de R17/R18.
  *Hecho:* `tests/unit/types/chat-media-envio-tipos.test.ts` asserta con `expectTypeOf` /
  asignación que `"imagen" | "video" | "audio" | "documento"` son asignables a `ChatMensajeTipo`,
  y `tests/integration/db/chat-mensaje-media-migration.test.ts` (ya existente) sigue verde sin
  añadir ninguna migración nueva (`git status` de `db/migrations/` sin altas al cerrar la feature
  se comprueba en el review, pero el assert es el de tipos).

- [x] **A1. [P]** `lib/config/chat-media-envio.ts` (NUEVO): `MIMES_ENVIO`, `LIMITE_BYTES`,
  `LIMITE_DOCUMENTO_BYTES`, `FORMATOS_NOTA_VOZ`, `MAX_CAPTION`, `TIMEOUT_SUBIDA_MS`,
  `MAX_LADO_LARGO_ENVIO`, `CALIDAD_JPEG_ENVIO`, y las funciones puras `clasificarAdjunto(mime)` y
  `validarAdjunto(mime, bytes)` (design §2). Cubre R8, R9, R10, R12.
  *Hecho:* `tests/unit/config/chat-media-envio.test.ts` asserta que
  (a) `clasificarAdjunto("application/pdf") === "documento"`, `("image/jpeg") === "imagen"`,
  `("audio/ogg") === "audio"`, `("video/mp4") === "video"` y los cinco MIME de Word/Excel dan
  `"documento"`; (b) `clasificarAdjunto("image/webp") === null` y `("image/heic") === null`
  (**no están en la lista de Meta; entran por la normalización de A4, no por aquí**);
  (c) `validarAdjunto("image/jpeg", 5*1024*1024 + 1)` devuelve
  `{ ok:false, motivo:"demasiado_grande", limiteBytes: 5*1024*1024 }` y con 5 MB exactos devuelve
  `{ ok:true, tipo:"imagen" }`; (d) `validarAdjunto("application/x-msdownload", 10)` devuelve
  `motivo:"tipo_no_permitido"`; (e) **todos** los elementos de `FORMATOS_NOTA_VOZ` están en
  `MIMES_ENVIO.audio` (regresión: impide añadir `audio/webm` a la lista de grabación);
  (f) **D6/P3:** `LIMITE_BYTES.documento === LIMITE_DOCUMENTO_BYTES && LIMITE_DOCUMENTO_BYTES === 25*1024*1024`
  —el assert prueba además que el número **no está duplicado**: la tabla referencia la constante—,
  y `validarAdjunto("application/pdf", 26*1024*1024)` devuelve `demasiado_grande` con
  `limiteBytes: 25*1024*1024` (un PDF de 30 MB, que Meta aceptaría, aquí se rechaza a propósito).

- [x] **A4.** `lib/utils/comprimir-imagen.ts`: añadir la opción `devolverOriginalSiMayor`
  (default `true`, comportamiento histórico) y **cubrir con tests el comportamiento del que ahora
  depende la 316** — hoy el helper no tiene ninguno (design §2.1). `[P]` con A1/A2. Cubre R29,
  R30, R31, R32.
  *Hecho:* `tests/unit/utils/comprimir-imagen.test.ts` (NUEVO), con `createImageBitmap`,
  `HTMLCanvasElement.prototype.getContext` y `toBlob` stubbeados, asserta que
  (a) **R29:** un `File` `image/heic` de 3 MB devuelve un `File` con `type === "image/jpeg"` y
  nombre terminado en `.jpg`;
  (b) **R29, el caso que el atajo se comía en silencio:** un `File` `image/heic` de **200 KB**
  (por debajo del `saltarSiMenorA` por defecto de 1 MB) llamado con `saltarSiMenorA: 0`
  **TAMBIÉN** se convierte (`type === "image/jpeg"`), y llamado SIN esa opción devuelve el
  original — el segundo assert documenta por qué la opción es obligatoria aquí;
  (c) **puerta 3:** con `toBlob` devolviendo un blob MÁS GRANDE que el original, con
  `devolverOriginalSiMayor: false` devuelve el JPEG convertido, y **con el default (`true`)
  devuelve el original** (regresión que protege a las 4 superficies existentes:
  `GestionarOrdenPanel`, `ReportarIncidenteModal`, `GestionarDesdeAyudaModal`, `PostulacionForm`);
  (d) **R30:** `createImageBitmap` fue invocado con `{ imageOrientation: "from-image" }`
  (`expect(createImageBitmapMock.mock.calls[0][1]).toEqual({ imageOrientation: "from-image" })`)
  — es lo máximo que puede afirmar jsdom, que no rasteriza; la comprobación de que la foto **no
  llega girada** se hace a ojo en un móvil real y se anota en `progress/`, no se finge en un test;
  (e) **R31:** con `toBlob` devolviendo `null`, el helper devuelve el `File` original y su `type`
  sigue siendo `image/heic` ⇒ `clasificarAdjunto` da `null` ⇒ es el camino de excepción de E1(g).

- [x] **A2. [P]** `lib/interfaces/repositories/IChatMensajeRepository.ts`: añadir a
  `InsertarSalienteInput` los cuatro campos `mediaId/mediaMime/mediaNombre/mediaTamanoBytes`
  opcionales (design §1.1; NO se usa `Partial<ChatMensajeCamposMedia>` entero). Cubre R17.
  *Hecho:* el typecheck del repo pasa tras A3 y un test de tipos en
  `tests/unit/types/chat-media-envio-tipos.test.ts` asserta que `InsertarSalienteInput` **no**
  admite `reaccionEmoji` (`@ts-expect-error`), y sí `mediaId`.

- [x] **A3.** `lib/repositories/ChatMensajeRepository.insertarSaliente()`: escribir las cuatro
  columnas nuevas. Depende de A2. Cubre R17, R18.
  *Hecho:* `tests/unit/repositories/chat-mensaje-repository.test.ts` asserta que un saliente con
  `{ tipo:"imagen", mediaId:"MEDIA-1", mediaMime:"image/jpeg", mediaTamanoBytes: 1234 }` llega al
  `data` de Prisma con esas cuatro columnas y que el DTO devuelto las expone; y que un saliente de
  `texto` las persiste `null` (no se cuelan defaults).

## Bloque B — Integración con Meta

- [x] **B1. [P]** `lib/clients/whatsapp-media-upload.ts` (NUEVO): `POST /<version>/<numeroId>/media`
  multipart con `messaging_product=whatsapp`, `type` y `file`; outcome tipado
  `ok | rechazado | error`; `fetchImpl` inyectable y `AbortSignal.timeout` (design §3.1).
  Depende de A1. Cubre R17, R19, R28.
  *Hecho:* `tests/unit/clients/whatsapp-media-upload.test.ts` asserta que
  (a) con un 200 `{"id":"MEDIA-9"}` devuelve `{ status:"ok", mediaId:"MEDIA-9" }`;
  (b) el `fetchImpl` recibió un `FormData` (`init.body instanceof FormData`) con
  `messaging_product === "whatsapp"`, y que las cabeceras **no** traen `Content-Type` fijado a
  mano (lo pone el runtime con el boundary);
  (c) un 400 devuelve `status:"rechazado"` con `codigoMeta` y un fallo de red `status:"error"`;
  (d) un 200 con `{}` devuelve `status:"error"` y **no** un `ok` con `mediaId` vacío;
  (e) **R28:** ningún `detalle` de ninguna rama contiene el token
  (`expect(detalle).not.toContain(config.token)`) y el token viaja solo en `Authorization`.

- [x] **B2. [P]** `lib/clients/whatsapp-cloud.ts`: método `enviarMedia(destino, tipo, mediaId,
  { caption?, filename? })` que **reusa `enviar()`** (JSON). Depende de A1. Cubre R5, R6, R17.
  *Hecho:* `tests/unit/clients/whatsapp-cloud-enviar-media.test.ts` asserta sobre el body
  serializado que (a) con `tipo:"image"` y caption sale
  `{type:"image", image:{id, caption}}`; (b) con `tipo:"audio"` **no** existe la clave `caption`
  aunque se pase (`expect(body.audio.caption).toBeUndefined()`, R6); (c) con `tipo:"document"` y
  `filename` sale `document:{id, filename, caption}`; (d) un 400 devuelve `permanente` y un 503
  `transitorio`, igual que `enviarTexto`.

- [x] **B3.** `cuerpoParaLog` (`lib/services/whatsapp/chat-logger.ts`): redactar `caption` y
  `filename` además del destinatario. Depende de B2. Cubre R28.
  *Hecho:* `tests/unit/services/whatsapp-fallo-saliente.test.ts` (o el test del logger) asserta que
  el string volcado por el logger tras un `enviarMedia` fallido **no contiene** el texto del
  caption ni el nombre del archivo, y **sí** contiene el código HTTP.

## Bloque C — Service

- [x] **C1.** `ChatWhatsappService.enviarMedia(input)` con el orden de operaciones de design §4:
  hilo → ventana → `validarAdjunto` → subir → enviar → persistir. Depende de A1, A3, B1, B2.
  Cubre R3, R11, R17, R18, R19, R20.
  *Hecho:* `tests/unit/services/chat-whatsapp-service.test.ts` asserta que
  (a) **R3:** sin entrante en las últimas 24 h devuelve `fuera_ventana` y
  `subidor.subir` **no fue llamado** (`expect(subir).not.toHaveBeenCalled()`) ni `insertarSaliente`;
  (b) **R11:** con `mime:"image/heic"` devuelve `tipo_no_permitido` y con una imagen de 6 MB
  devuelve `demasiado_grande` con su `limiteBytes`, en ambos casos sin llamar a `subir`;
  (c) **R17:** en el camino feliz, `insertarSaliente` recibe
  `{ tipo:"imagen", estado:"sent", mediaId:"MEDIA-1", mediaMime, mediaNombre, mediaTamanoBytes }`
  y `waMessageId` el de Meta;
  (d) **R19:** si `subir` devuelve `error`, `client.enviarMedia` **no** se llama e
  `insertarSaliente` **no** se llama ninguna vez (nada persistido);
  (e) **R20:** si `enviarMedia` devuelve `transitorio`, `insertarSaliente` recibe
  `estado:"failed"` con `error.detalle` y `mediaId`, y `encolarReintento` **no** fue llamado;
  (f) **R18:** ninguno de los argumentos que recibe `insertarSaliente` contiene los bytes del
  adjunto (`expect(JSON.stringify(args)).not.toContain(MARCA_BINARIA)`) ni un `Blob`/`ArrayBuffer`.

- [x] **C2.** Guarda de `reintentarEnvio` + re-tipado de `persistirFalloPermanente`
  (design §4.1/§4.2). Depende de C1. Cubre R21.
  *Hecho:* el mismo test asserta que, dado un mensaje `queued` con `tipo:"imagen"`,
  `reintentarEnvio` **no llama** a `client.enviarTexto` (`expect(enviarTexto).not.toHaveBeenCalled()`),
  llama a `marcarFallido` y no lanza; y que con `tipo:"texto"` el comportamiento actual sigue
  intacto (llama a `enviarTexto`) — regresión de la 109/120.

## Bloque D — Server Action y contrato

- [x] **D1.** `EnviarMediaChatResult` en `lib/types/chat-whatsapp.ts` (design §5). `[P]` con C.
  Cubre R9, R10, R12, R19, R20.
  *Hecho:* test de tipos en `tests/unit/types/chat-media-envio-tipos.test.ts`: un `switch`
  exhaustivo sobre el union compila sin `default` (assert de exhaustividad con `never`), y
  `@ts-expect-error` sobre `{ status:"transitorio" }` prueba que ese caso **no** existe (design
  §5: un adjunto no se encola).

- [x] **D2.** `enviarMediaChat(formData, deps)` en `lib/actions/chat-whatsapp.ts`, con el patrón
  `FormData` de `lib/actions/incidentes.ts`. Depende de C1, D1. Cubre R11, R12, R26, R27.
  *Hecho:* `tests/unit/actions/chat-whatsapp-actions.test.ts` asserta que
  (a) **R26:** sin actor devuelve `unauthenticated` y ni `ordenReader.findParaEnvio` ni
  `service.enviarMedia` fueron llamados;
  (b) **R27:** con actor pero `findParaEnvio` → `null` devuelve `forbidden` y
  `service.enviarMedia` **no** fue llamado;
  (c) **R11:** un `FormData` con un `File` de 6 MB `image/jpeg` devuelve `demasiado_grande`
  **aunque el FormData incluya un campo `tamano: "10"` mentiroso**, y el servicio no se llama
  (el servidor mide `archivo.size`, no lo que le declaran);
  (d) **R12:** un `caption` de `MAX_CAPTION + 1` devuelve `caption_largo` sin llamar al servicio;
  (e) camino feliz: devuelve `{ status:"ok", mensajeChatId }` y el service recibió el `caption` y
  el `mime` del archivo.

## Bloque E — UI: composer y nota de voz

- [x] **E1.** Composer de `ChatConversacion.tsx`: botón de clip + menú de cuatro vías, inputs
  ocultos, estado `adjunto`, previsualización con quitar, `maxLength` = `MAX_CAPTION` con adjunto,
  bloqueo por `textoLibreHabilitado`, envío único, `enviando`, `accept="image/*"` y la secuencia
  **normalizar → clasificar → validar** de design §2.1/§6.1. Depende de D2, A4.
  Cubre R1, R2, R4, R5, R7, R12, R29, R30, R31, R32.
  *Hecho:* `tests/components/ChatComposerAdjunto.test.tsx` asserta que
  (a) **R1:** al pulsar el clip aparecen cuatro opciones con nombre accesible
  (`getByRole("menuitem", { name:/cámara|archivo|nota de voz|documento/i })`, 4 resultados);
  (b) **R2:** con `textoLibreHabilitado: false` el botón de clip está `disabled` y hay texto
  visible explicando que tampoco se pueden enviar adjuntos;
  (c) **R4:** tras elegir un `File` de imagen se ve la previsualización con su nombre y el botón
  "Quitar adjunto"; al pulsarlo, el adjunto desaparece y `enviarMediaChat` **no** fue llamado;
  (d) **R5:** con adjunto + texto, al enviar se llama **una sola vez** a `enviarMediaChat` con un
  `FormData` cuyo `caption` es ese texto, y `enviarMensajeChat` **no** se llama;
  (e) **R7:** con la promesa de envío pendiente, un segundo click y un `Enter` no producen una
  segunda llamada (`expect(enviarMediaChat).toHaveBeenCalledTimes(1)`);
  (f) **R12:** con adjunto seleccionado, el `<textarea>` tiene `maxLength = MAX_CAPTION`;
  (g) **R29 (iPhone, el caso que justifica todo esto):** al elegir un `File`
  `foto.heic`/`image/heic`, el `FormData` que recibe `enviarMediaChat` lleva un archivo con
  `type === "image/jpeg"`, y **el original no se sube**
  (`expect(fd.get("archivo").type).toBe("image/jpeg")` y `.not.toBe("image/heic")`);
  (h) **R29, HEIC pequeño:** con un `image/heic` de 200 KB, `comprimirImagen` fue invocado con
  `saltarSiMenorA: 0` (`expect(comprimirImagenMock.mock.calls[0][1].saltarSiMenorA).toBe(0)`) y lo
  enviado sigue siendo `image/jpeg` — el atajo por tamaño no se cuela;
  (i) **R30:** un `image/heic` de 8 MB cuya conversión devuelve 1 MB **se envía**
  (`enviarMediaChat` llamado 1 vez), es decir, el límite se evalúa sobre el resultado y no sobre
  el original;
  (j) **R32:** un `image/jpeg` de 9 MB se normaliza y se envía si queda por debajo de 5 MB; y si
  la conversión devuelve 7 MB, **no** se llama a `enviarMediaChat` y se ve el aviso de límite;
  (k) **R31:** con `comprimirImagen` devolviendo el original `image/heic` (fallo de decodificación
  o `toBlob` nulo), se ve el aviso "No se pudo preparar la foto" —texto DISTINTO del de tipo no
  permitido— y `enviarMediaChat` **no** fue llamado.

- [x] **E2.** `hooks/useGrabadorVoz.ts` + vía de nota de voz (design §6.2). **P1 CERRADA
  (opción A), sin bloqueo.** Depende de E1. Cubre R6, R13, R14, R15, R16.
  *Hecho:* `tests/components/ChatNotaVoz.test.tsx`, con `MediaRecorder`/`getUserMedia` mockeados,
  asserta que
  (a) **R14:** con `isTypeSupported` que solo acepta `audio/ogg;codecs=opus`, el `MediaRecorder`
  se construyó con ese `mimeType` (`expect(ctorArgs[1].mimeType).toBe("audio/ogg;codecs=opus")`);
  y con un stub que acepta **solo** `audio/webm;codecs=opus`, **no** se construye ningún
  `MediaRecorder` (`expect(MediaRecorderMock).not.toHaveBeenCalled()`);
  (b) **R15:** en ese mismo caso, la opción "Nota de voz" está `disabled` y se ve el texto de que
  no está disponible en este navegador, y las otras tres vías siguen habilitadas;
  (c) **R13:** tras grabar y detener aparece un `<audio controls>` con la grabación y un botón
  "Descartar" que la elimina sin llamar a `enviarMediaChat`;
  (d) **R16:** si `getUserMedia` rechaza, se pinta un aviso explícito, la UI vuelve al composer
  (no queda en "Grabando") y `stop()` de las pistas fue llamado;
  (e) **R6:** al enviar la nota con texto escrito, el `FormData` **no** lleva `caption` y el texto
  **sigue** en el `<textarea>` después del envío.

- [x] **E3. [P]** `MediaAdjunto.tsx`: prop `direccion` y `textoAccesible(tipo, direccion)` en
  `chat-format.ts`; `BurbujaContenido.tsx` solo la propaga (design §6.3). Cubre R23.
  *Hecho:* `tests/components/ChatBurbujaMedia.test.tsx` (existente, se amplía) asserta que un
  mensaje `{ tipo:"imagen", direccion:"saliente" }` produce un `<img>` cuyo `alt` **no contiene**
  "cliente" y sí "enviaste"; y que el entrante conserva "Imagen enviada por el cliente"
  (regresión de la 311). Ídem para `audio` (`aria-label` del reproductor).

## Bloque F — Hilo, proxy y cierre

- [x] **F1.** Burbuja saliente con adjunto de punta a punta en el hilo. Depende de E1, E3.
  Cubre R22.
  *Hecho:* `tests/components/ChatBurbujaMedia.test.tsx` asserta que, con
  `listarHiloChat` devolviendo un saliente `{ tipo:"imagen", media:{...}, estado:"sent" }`, el
  `<li>` tiene `data-direccion="saliente"`, contiene el adjunto y muestra el acuse (`Check`), sin
  recargar (el harness `_chat-hilo-harness.tsx` ya monta el hilo con SWR).

- [x] **F2. [P]** Verificar por test que el proxy sirve un SALIENTE sin cambios (design §6.4).
  Cubre R24, R25.
  *Hecho:* `tests/integration/api/chat-media-proxy.route.test.ts` (existente, se amplía) asserta
  que con un mensaje `direccion:"saliente"` y `mediaId` presente, el handler responde `200` con el
  binario para el mensajero asignado, `403` para otro mensajero, y `410` cuando el descargador
  devuelve `expirado`; y que la respuesta **no contiene** el `media_id` de Meta en ninguna
  cabecera ni en el cuerpo. **Este test debe pasar sin modificar
  `app/api/chat/media/[mensajeId]/route.ts`** (si obliga a tocarlo, la premisa del design §6.4 era
  falsa y hay que volver a la puerta).

- [x] **F3.** `progress/impl_316-chat-enviar-media.md` con el mapa R→test REAL (ruta + nombre del
  `it`), medido tras correr los tests, no copiado de aquí. Depende de todo. Cubre la regla 4 de
  `CLAUDE.md`.
  *Hecho:* los 32 requisitos aparecen con un test existente y verde; el reviewer asserta que no
  hay ninguno huérfano. Se anota además el resultado de **S1** si hubo un iPhone a mano.

- [ ] **F4.** Gate: `./init.sh --rapido` en verde. Depende de F3.
  *Hecho:* typecheck + lint + tests relacionados + guardias en verde. **Ojo:** esta feature no
  toca migraciones ni `lib/types/` de cimientos, así que el modo rápido no debería negarse; si se
  niega, se corre `./init.sh` completo (regla 5 de `CLAUDE.md`).

---

## Mapa R → test

| R | Qué prueba | Test (ruta) | Assert |
| --- | --- | --- | --- |
| R1 | cuatro vías de adjuntar | `tests/components/ChatComposerAdjunto.test.tsx` | 4 `menuitem` con nombre accesible cámara/archivo/nota de voz/documento |
| R2 | clip bloqueado fuera de ventana | `tests/components/ChatComposerAdjunto.test.tsx` | clip `disabled` con `textoLibreHabilitado:false` + texto visible del porqué |
| R3 | servidor rechaza fuera de ventana sin subir | `tests/unit/services/chat-whatsapp-service.test.ts` | `fuera_ventana` y `subir` **no** llamado |
| R4 | preview y quitar antes de enviar | `tests/components/ChatComposerAdjunto.test.tsx` | preview visible; "Quitar adjunto" limpia y no envía |
| R5 | un solo mensaje con pie | `tests/components/ChatComposerAdjunto.test.tsx` + `tests/unit/clients/whatsapp-cloud-enviar-media.test.ts` | `enviarMediaChat` 1 vez con `caption`; `enviarMensajeChat` 0; body `image.caption` |
| R6 | audio sin pie, texto conservado | `tests/components/ChatNotaVoz.test.tsx` + `tests/unit/clients/whatsapp-cloud-enviar-media.test.ts` | `FormData` sin `caption`, textarea conserva el texto; `body.audio.caption` `undefined` |
| R7 | sin doble envío | `tests/components/ChatComposerAdjunto.test.tsx` | `toHaveBeenCalledTimes(1)` con click + Enter en vuelo |
| R8 | clasificación por MIME | `tests/unit/config/chat-media-envio.test.ts` | `clasificarAdjunto` mapea los 12 MIME de la tabla al tipo correcto |
| R9 | tipo no permitido (tras normalizar) | `tests/unit/config/chat-media-envio.test.ts` + `tests/unit/services/chat-whatsapp-service.test.ts` | `motivo:"tipo_no_permitido"`; service devuelve el status y no sube |
| R10 | tamaño excedido, documento a 25 MB | `tests/unit/config/chat-media-envio.test.ts` + `tests/unit/services/chat-whatsapp-service.test.ts` | `LIMITE_BYTES.documento === LIMITE_DOCUMENTO_BYTES === 25 MB`; PDF de 26 MB → `demasiado_grande`; borde exacto pasa |
| R11 | doble validación, servidor no confía | `tests/unit/actions/chat-whatsapp-actions.test.ts` | 6 MB rechazado pese al campo `tamano` mentiroso del `FormData` |
| R12 | tope del pie | `tests/unit/actions/chat-whatsapp-actions.test.ts` + `tests/components/ChatComposerAdjunto.test.tsx` | `caption_largo` sin llamar al service; `maxLength === MAX_CAPTION` |
| R13 | escuchar y descartar la nota | `tests/components/ChatNotaVoz.test.tsx` | `<audio controls>` tras detener; "Descartar" limpia sin enviar |
| R14 | formato MEDIDO, no supuesto | `tests/components/ChatNotaVoz.test.tsx` | `MediaRecorder` construido con el primer MIME soportado de `FORMATOS_NOTA_VOZ` |
| R15 | sin formato aceptado, no se graba | `tests/components/ChatNotaVoz.test.tsx` | con solo `audio/webm` soportado: `MediaRecorder` **no** construido + opción `disabled` con aviso |
| R16 | permiso denegado | `tests/components/ChatNotaVoz.test.tsx` | aviso explícito, no queda "Grabando", `track.stop()` llamado |
| R17 | subir + enviar + persistir | `tests/unit/services/chat-whatsapp-service.test.ts` + `tests/unit/repositories/chat-mensaje-repository.test.ts` | `insertarSaliente` con tipo/estado/`media*`; el repo escribe las 4 columnas |
| R18 | sin binario propio | `tests/unit/services/chat-whatsapp-service.test.ts` | ningún argumento persistido contiene los bytes ni un `Blob`/`ArrayBuffer` |
| R19 | fallo de subida no persiste | `tests/unit/services/chat-whatsapp-service.test.ts` | `enviarMedia` y `insertarSaliente` **no** llamados; status `fallo_subida` |
| R20 | fallo de envío = failed sin cola | `tests/unit/services/chat-whatsapp-service.test.ts` | `insertarSaliente` con `estado:"failed"` + `mediaId`; `encolarReintento` **no** llamado |
| R21 | el reintento no lo manda como texto | `tests/unit/services/chat-whatsapp-service.test.ts` | con `queued` de `tipo:"imagen"`: `enviarTexto` **no** llamado, `marcarFallido` sí |
| R22 | burbuja saliente en el hilo | `tests/components/ChatBurbujaMedia.test.tsx` | `<li data-direccion="saliente">` con adjunto y acuse |
| R23 | textos accesibles por dirección | `tests/components/ChatBurbujaMedia.test.tsx` | `alt` del saliente sin "cliente"; entrante conserva el texto de la 311 |
| R24 | el proxy sirve el saliente sin cambios | `tests/integration/api/chat-media-proxy.route.test.ts` | `200` al mensajero asignado, `403` a otro, sin `media_id` en la respuesta |
| R25 | adjunto propio caducado | `tests/integration/api/chat-media-proxy.route.test.ts` + `tests/components/ChatBurbujaMedia.test.tsx` | `410` con `expirado`; la burbuja saliente muestra "Este archivo ya no está disponible." |
| R26 | sin sesión | `tests/unit/actions/chat-whatsapp-actions.test.ts` | `unauthenticated` y `service.enviarMedia` **no** llamado |
| R27 | orden ajena | `tests/unit/actions/chat-whatsapp-actions.test.ts` | `forbidden` con `findParaEnvio` → `null`, sin llamar al service |
| R28 | PII y token fuera de los logs | `tests/unit/clients/whatsapp-media-upload.test.ts` + `tests/unit/services/whatsapp-fallo-saliente.test.ts` | `detalle` sin token; volcado sin caption ni filename, con el código HTTP |
| R29 | HEIC/WebP → JPEG, sin atajo por tamaño | `tests/unit/utils/comprimir-imagen.test.ts` + `tests/components/ChatComposerAdjunto.test.tsx` | helper: heic 3 MB y **heic 200 KB con `saltarSiMenorA: 0`** salen `image/jpeg`; composer: `fd.get("archivo").type === "image/jpeg"` y nunca `image/heic` |
| R30 | orientación EXIF + límite sobre el RESULTADO | `tests/unit/utils/comprimir-imagen.test.ts` + `tests/components/ChatComposerAdjunto.test.tsx` | `createImageBitmap` invocado con `{ imageOrientation:"from-image" }`; heic de 8 MB que convierte a 1 MB **se envía** |
| R31 | fallo de conversión = aviso propio | `tests/unit/utils/comprimir-imagen.test.ts` + `tests/components/ChatComposerAdjunto.test.tsx` | `toBlob` → `null` devuelve el original; composer muestra "No se pudo preparar la foto" (texto ≠ tipo no permitido) y no llama a `enviarMediaChat` |
| R32 | imagen en lista blanca pero grande | `tests/components/ChatComposerAdjunto.test.tsx` | jpeg de 9 MB → convertida a 1 MB se envía; convertida a 7 MB se rechaza por tamaño |
| — | regresión de las 4 superficies que ya usan el helper | `tests/unit/utils/comprimir-imagen.test.ts` | con el default `devolverOriginalSiMayor: true`, un blob mayor que el original devuelve el ORIGINAL (comportamiento histórico intacto) |

## Dependencias en corto

```
A0 [P]  A1 [P]  A4 [P]  A2 ──► A3
                    A1 ──► B1 [P]  B2 [P] ──► B3
            A3, B1, B2 ──► C1 ──► C2
                    A1, C1 ──► D1 [P] ──► D2
                    D2, A4 ──► E1 ──► E2
                                 E3 [P]
                         E1, E3 ──► F1     F2 [P]
                      todo ──► F3 ──► F4
```

**Nota de trazabilidad:** los requisitos de normalización se numeraron **R29–R32** (a
continuación de los 28 originales) en vez de renumerar la lista entera, para que ningún `R<n>` ya
mapeado cambie de significado a mitad de la feature. El mapa de arriba cubre **los 32**, sin
huérfanos.
