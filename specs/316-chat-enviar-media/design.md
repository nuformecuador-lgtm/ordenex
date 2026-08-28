# Feature 316 — Design

> Decisiones técnicas. Continúa la 311 (entrante) con el SALIENTE. Todo lo que aquí no se
> redefine se hereda sin cambios: puerta de autorización (`OrdenEnvioReader.findParaEnvio`),
> ventana de 24 h, polling SWR del hilo, proxy de media, RLS de las tablas de chat.
> El precedente estructural es la propia 311, que llevó un tipo nuevo de punta a punta; aquí el
> camino es el INVERSO (UI → action → service → cliente Meta → repo) y **no hay migración**.

## 0. Principio rector

Extensión **aditiva y sin esquema**: se añade el camino de ESCRITURA que falta, un cliente nuevo
de subida, un archivo de configuración nuevo y piezas de UI. **No se crean tablas ni columnas, no
hay migración, no hay ruta nueva, no se toca el middleware.** Regla anti-sobre-ingeniería de
`docs/architecture.md`.

---

## 1. Modelo de datos — verificado: NO hace falta migración

Medido en `dev` el 2026-08-28 sobre `db/schema.prisma`:

| Comprobación | Evidencia | Estado |
| --- | --- | --- |
| Enum con los tipos de adjunto | `schema.prisma:257-273`: `imagen`, `audio`, `video`, `documento`, `sticker` | ya existen |
| Columnas del adjunto | `schema.prisma:343-346`: `mediaId`, `mediaMime`, `mediaNombre`, `mediaTamanoBytes`, todas `String?`/`Int?` | ya existen |
| ¿Prohíben un saliente con esas columnas llenas? | no hay `CHECK` ni índice que ate `direccion` con `tipo` ni con `media_*` | nada lo impide |

**Lo que falta es SOLO el camino de escritura:**

- `InsertarSalienteInput` (`lib/interfaces/repositories/IChatMensajeRepository.ts:78-88`) **no
  tiene campos `media*`** — a diferencia de `InsertarEntranteInput:66`, que ya extiende
  `Partial<ChatMensajeCamposMedia>`.
- `ChatMensajeRepository.insertarSaliente()` no escribe esas columnas.

### 1.1 Cambio en la interfaz del repositorio

```ts
export interface InsertarSalienteInput {
  // ...campos actuales (conversacionId, tipo, cuerpo, plantillaId, waMessageId, estado,
  //    ocurridoAt, error)
  /** Feature 316: adjunto propio ya subido a Meta. Ausentes en texto/plantilla. */
  mediaId?: string | null;
  mediaMime?: string | null;
  mediaNombre?: string | null;
  mediaTamanoBytes?: number | null;
}
```

**Se añaden los CUATRO campos de media y no `Partial<ChatMensajeCamposMedia>` entero** (que
arrastraría `reaccion*`, `contactos` y `sistema*`): un saliente de esta feature nunca es una
reacción, ni contactos, ni un evento de sistema, y ofrecer esos campos en el input de escritura
sería una puerta abierta a persistir un saliente imposible. El DTO de lectura
(`ChatMensajeDTO`) ya los trae todos y **no se toca**.

`mediaTamanoBytes` en un saliente **sí se conoce siempre** (`File.size`), a diferencia del
entrante, donde Meta casi nunca lo manda (P2 de la 311). Es la única asimetría con el entrante y
hace que la burbuja propia muestre el tamaño desde el primer momento.

---

## 2. Política de SUBIDA — `lib/config/chat-media-envio.ts` (archivo nuevo)

**Por qué un archivo nuevo y no ampliar `lib/config/chat-media.ts`:** aquel es política de
SERVIDO —"qué puedo pintar `inline` desde mi origen sin XSS"— y su `MIMES_INCRUSTABLES` (4
tipos de imagen) es deliberadamente MÁS ESTRECHA que lo que se puede enviar, porque no incluye
PDF ni vídeo ni audio a propósito. Mezclarlas invita al error de un solo sentido pero fatal: usar
`MIMES_INCRUSTABLES` como whitelist de subida dejaría fuera todo lo que esta feature existe para
enviar, y —peor— usar la whitelist de subida como política de servido volvería incrustables PDF y
documentos de Office. **Dos listas, dos archivos, dos comentarios que explican por qué no son la
misma.**

```ts
/** Tipo de mensaje que se deriva del MIME del adjunto (R8). */
export type TipoAdjuntoEnvio = "imagen" | "video" | "audio" | "documento";

/** MIME aceptados por Meta para CADA tipo de mensaje saliente. */
export const MIMES_ENVIO: Readonly<Record<TipoAdjuntoEnvio, ReadonlySet<string>>>;

/** Límite de Meta por tipo, en bytes. */
export const LIMITE_BYTES: Readonly<Record<TipoAdjuntoEnvio, number>>;

/** Formatos de audio que Meta acepta, EN ORDEN DE PREFERENCIA para grabar (R14). */
export const FORMATOS_NOTA_VOZ: readonly string[];

/**
 * Tope PROPIO de los documentos (D6/P3), 25 MB: más restrictivo que los 100 MB de Meta porque
 * quien sube es un repartidor por red móvil. UNA constante, para que cambiarlo sea una línea:
 * `LIMITE_BYTES.documento` la referencia, no repite el número.
 */
export const LIMITE_DOCUMENTO_BYTES = 25 * 1024 * 1024;

/** Lado largo y calidad de la normalización de imagen (R29/R30, design §2.1). */
export const MAX_LADO_LARGO_ENVIO = 1600;
export const CALIDAD_JPEG_ENVIO = 0.85;

/** Máximo de caracteres de un pie de adjunto (R12). */
export const MAX_CAPTION = 1024;

/** MIME -> tipo de mensaje; `null` = no se puede enviar (R9). Función PURA. */
export function clasificarAdjunto(mime: string): TipoAdjuntoEnvio | null;

/** Desenlace de la validación, compartido por navegador y servidor (R11). Función PURA. */
export function validarAdjunto(
  mime: string,
  bytes: number,
): { ok: true; tipo: TipoAdjuntoEnvio } | { ok: false; motivo: "tipo_no_permitido" }
  | { ok: false; motivo: "demasiado_grande"; limiteBytes: number };
```

| Tipo | MIME aceptados | Límite Meta |
| --- | --- | --- |
| imagen | `image/jpeg`, `image/png` | 5 MB |
| vídeo | `video/mp4`, `video/3gp` | 16 MB |
| audio | `audio/aac`, `audio/mp4`, `audio/mpeg`, `audio/amr`, `audio/ogg` | 16 MB |
| documento | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | **25 MB (tope propio, D6)** |

**`image/webp` e `image/heic` NO están en `MIMES_ENVIO`, y eso es correcto**: son los MIME que
Meta acepta, y Meta no acepta ninguno de los dos como imagen (webp solo vale para stickers). Lo
que NO se hace es rechazar por ello: una imagen fuera de la lista blanca se **normaliza a JPEG en
el navegador** antes de llegar aquí (§2.1, R29–R32/D7). La regla de "¿esta imagen es
normalizable?" es `mime.startsWith("image/") && !MIMES_ENVIO.imagen.has(mime)` —deliberadamente
por familia y no por una lista de HEIC/WebP/AVIF/TIFF—, porque el criterio real no es qué formato
es, sino **si el navegador de ese dispositivo sabe decodificarlo**, y eso solo se sabe
intentándolo.

**`clasificarAdjunto` es la ÚNICA fuente del tipo del mensaje.** Ni la UI ni la acción deciden por
extensión de archivo: la extensión la controla quien nombra el archivo y el tipo del mensaje
decide el endpoint de Meta y la columna `tipo` que persiste.

### 2.1 Normalización de imagen para iPhone (R29–R32, D7) — se REUSA `comprimirImagen`

**El helper de canvas ya existe en el repo: `lib/utils/comprimir-imagen.ts`.** No se escribe uno
nuevo. Lo usan hoy cuatro superficies (`GestionarOrdenPanel.tsx:471`,
`ReportarIncidenteModal.tsx:141`, `GestionarDesdeAyudaModal.tsx:256`, `PostulacionForm.tsx:197`) y
hace exactamente el camino que esta feature necesita:

- `createImageBitmap(file, { imageOrientation: "from-image" })` (línea 44) → **la orientación EXIF
  ya está tratada**, que es el fallo clásico de este camino; su propio comentario (líneas 41-43)
  dice que sin eso "la evidencia podría quedar de lado". No hay que reinventarlo ni "acordarse".
- Redimensiona el lado largo (líneas 45-47) y recodifica con
  `canvas.toBlob(resolve, "image/jpeg", calidad)` (línea 61), devolviendo un `File` con nombre
  `.jpg` y `type: "image/jpeg"` (línea 68). Esa es la conversión HEIC/WebP→JPEG.
- El redimensionado **acota la memoria**, que es el otro riesgo: una foto de 12 MP decodificada
  son ~48 MB de bitmap en RAM; se reduce a 1600 px de lado largo y se llama a `bitmap.close()`
  (línea 58) en cuanto se ha dibujado.

**El problema es su POLÍTICA DE FALLO, que es la CONTRARIA a la que necesita la 316.** Su cabecera
lo dice literal (líneas 9-13): *"Comprimir es una OPTIMIZACION, no una validacion: ante cualquier
fallo se devuelve el archivo ORIGINAL para no bloquear la gestion"*. Ahí devolver el original es
correcto (el archivo ya era válido); aquí el original es **precisamente el que no se puede
enviar**. Son **TRES** puertas por las que el original vuelve intacto:

| # | Línea | Cuándo devuelve el original | Qué provoca en la 316 |
| --- | --- | --- | --- |
| 1 | `:38` `saltarSiMenorA` (default 1 MB) | la foto pesa menos de 1 MB | **Un HEIC pequeño sale sin convertir** y lo rechaza la lista blanca. Agujero real, no teórico: el atajo por tamaño es correcto para comprimir y es un BUG para convertir |
| 2 | `:69` `catch` | el navegador no sabe decodificar | el mensajero vería "tipo no permitido" en vez de "no se pudo preparar la foto": semánticamente distinto y peor (R31) |
| 3 | `:65` `blob.size >= file.size` | el JPEG salió MÁS GRANDE que el original | **el caso realista de la foto pequeña**: un HEIC de 300 KB re-encodeado puede quedar por encima. Devolvería HEIC y se rechazaría una foto perfectamente válida |

#### Decisión: opción (a) —usar `comprimirImagen` y comprobar después— con UNA opción aditiva

Se evaluaron las dos salidas que planteó el humano:

- **(b) Extraer el núcleo a una función compartida con dos políticas de fallo.** Más limpio
  conceptualmente, pero toca código que hoy funciona en **cuatro** superficies de producción, y
  —dato que pesa— **`comprimir-imagen.ts` no tiene hoy ningún test** (`tests/` no contiene ningún
  archivo `*comprimir*`). Refactorizar sin red, en una feature que no va de eso, es cambiar riesgo
  conocido por riesgo desconocido. **Descartada.**
- **(a) Llamarlo con `saltarSiMenorA: 0` y comprobar DESPUÉS el MIME del `File` devuelto**; si
  sigue fuera de la lista blanca, rechazo con motivo propio `no_convertible` ("No se pudo preparar
  la foto", R31), distinto de `tipo_no_permitido` (R9). Cierra las puertas 1 y 2 sin tocar a la
  evidencia de gestión. **Elegida**, con una corrección: **(a) a secas no cierra la puerta 3**, y
  la puerta 3 rechazaría fotos válidas. Por eso se añade al helper **una sola opción aditiva con
  default que preserva byte a byte el comportamiento actual**:

```ts
export interface ComprimirImagenOptions {
  // ...maxLadoLargo, calidad, saltarSiMenorA (sin cambios)
  /**
   * Feature 316: si el re-encode sale MAS GRANDE que el original, ¿devolver el original?
   * `true` (default) = comportamiento historico, para las 4 superficies que solo optimizan.
   * `false` = la conversion es OBLIGATORIA (HEIC/WebP -> JPEG): mas grande sigue siendo mejor
   * que un formato que Meta rechaza.
   */
  devolverOriginalSiMayor?: boolean; // default true
}
```

Es **una línea de condición** (`:65` pasa a `if (!blob || (devolverOriginalSiMayor && blob.size >= file.size)) return file;`)
y ningún llamador existente cambia de comportamiento porque el default es el de hoy. Eso es menos
superficie de cambio que (b) y no deja el agujero de (a) pura.

#### Cómo lo llama la 316

```ts
// En el composer, ANTES de validar tipo y tamaño (R30/R32).
const preparada = esImagen(file) && (fueraDeListaBlanca(file) || excedeLimite(file))
  ? await comprimirImagen(file, {
      saltarSiMenorA: 0,              // R29: sin atajo por tamaño. Un HEIC de 200 KB TAMBIEN se convierte
      devolverOriginalSiMayor: false, // puerta 3
      maxLadoLargo: MAX_LADO_LARGO_ENVIO,
      calidad: CALIDAD_JPEG_ENVIO,
    })
  : file;

// El helper NUNCA lanza: si no pudo, devuelve el original. La comprobación del MIME DESPUES es
// lo que convierte "no pudo" en un desenlace explícito (R31), en vez de en un rechazo por tipo.
if (clasificarAdjunto(preparada.type) === null) => motivo "no_convertible"   // R31
const v = validarAdjunto(preparada.type, preparada.size);                    // R30/R32: sobre el RESULTADO
```

**Orden de operaciones (importa):** normalizar → clasificar → validar tamaño → subir. El límite de
5 MB se comprueba **después** de convertir (R30), que es justo lo contrario de lo intuitivo y la
razón por la que una foto de 8 MB se envía sin problema.

**El servidor NO normaliza** (no hay `<canvas>` en Node y traer una librería de decodificación
HEIC al servidor está fuera de alcance): si un HEIC llega a la Server Action —petición fabricada, o
un cliente futuro sin este código— se rechaza con `tipo_no_permitido` (R9/R11). La defensa del
servidor sigue intacta; la normalización es una comodidad del navegador, no una puerta de
seguridad.

**Lo que NO resuelve este camino:** el vídeo. Recomprimirlo exigiría re-codificar fotograma a
fotograma con `MediaRecorder` sobre un `<video>` en reproducción —tiempo real, calidad perdida y
batería—, así que **queda fuera de alcance** y el vídeo de más de 16 MB se rechaza tras grabarlo
(D8/R10). Se deja dicho aquí para que nadie lo redescubra como "solo faltaba aplicarlo al vídeo".

---

## 3. Integración con Meta

### 3.1 `lib/clients/whatsapp-media-upload.ts` (archivo NUEVO)

**Por qué no cabe en `whatsapp-cloud.ts`:** su método privado `enviar()`
(`lib/clients/whatsapp-cloud.ts:139-207`) **siempre** pone `Content-Type: application/json` y
`body: JSON.stringify(cuerpo)`. Subir media es `multipart/form-data` **y el `Content-Type` lo
tiene que fijar el runtime con el `boundary`**, es decir, exactamente el bit que ese método no
puede ceder. Parchearlo con un flag "si es multipart no serialices" convertiría el método que hoy
tiene una sola forma en dos caminos con un condicional en medio, y el volcado de la petición
(línea 145) intentaría serializar un `FormData`. Va aparte, **simétrico a
`lib/clients/whatsapp-media.ts`**, que ya vive aparte por la misma clase de razón y lo dice en su
cabecera (líneas 1-16): *"va aparte de `whatsapp-cloud.ts` porque su desenlace es distinto"*.
Aquel solo DESCARGA; éste solo SUBE. Las tres invariantes se heredan literalmente: `fetchImpl`
inyectable, `AbortSignal.timeout`, token solo en `Authorization: Bearer` y **jamás** en URL, log
ni mensaje de error.

```
POST https://graph.facebook.com/<version>/<numeroId>/media
  multipart/form-data:
    messaging_product = "whatsapp"
    type              = <mime>
    file              = <Blob con filename>
  ->  200  { "id": "<media-id>" }
```

**Desenlace TIPADO, no excepciones** (mismo molde que `WhatsappEnvioOutcome` y
`WhatsappMediaOutcome`):

```ts
export type WhatsappMediaSubidaOutcome =
  | { status: "ok"; mediaId: string }
  | { status: "rechazado"; detalle: string; codigoMeta: number | null }  // 4xx: no reintentable
  | { status: "error"; detalle: string };                                // red, timeout, 5xx
```

El `id` se valida con `z.object({ id: z.string().min(1) })`; una forma inesperada es `error`, no
un `ok` con `undefined` colándose hasta la columna `media_id`.

### 3.2 `enviarMedia()` en `lib/clients/whatsapp-cloud.ts`

Este **sí** es JSON y **sí** reusa `enviar()` (misma URL `/messages`, mismo manejo de
`transitorio`/`permanente`, mismo volcado redactado):

```ts
async enviarMedia(
  destino: string,
  tipo: "image" | "video" | "audio" | "document",
  mediaId: string,
  opts?: { caption?: string; filename?: string },
): Promise<WhatsappEnvioOutcome>
```

```jsonc
{ "messaging_product": "whatsapp", "to": "<destino>", "type": "image",
  "image": { "id": "<media-id>", "caption": "<pie>" } }
```

`caption` se omite cuando el tipo es `audio` (R6) y cuando está vacío. `filename` solo se manda en
`document` (es lo que el cliente ve como nombre del archivo en su WhatsApp).

---

## 4. Service — `ChatWhatsappService.enviarMedia()`

Orden de operaciones **deliberado** (cada paso barato antes de cada paso caro):

```
1. upsert del hilo               (igual que enviarTexto)
2. ventana de 24 h  -> fuera_ventana         [R3: se sale ANTES de subir nada]
3. validarAdjunto(mime, bytes)  -> tipo_no_permitido / demasiado_grande  [R11: servidor]
4. subir a Meta      -> fallo => `fallo_subida`, SIN persistir nada       [R19]
5. enviar el mensaje -> ok        => insertarSaliente(estado sent, media*) [R17]
                     -> cualquier fallo => insertarSaliente(failed, media*, error)  [R20]
```

`EnviarMediaChatInput`: `{ ordenId, mensajeroId, telefonoE164, adjunto: { mime, nombre, bytes,
cuerpo: ArrayBuffer|Blob }, caption }`.

### 4.1 Reintento: se decide NO reintentar, y por qué (trampa medida)

Hoy `reintentarEnvio` (`ChatWhatsappService.ts:415-450`) bifurca solo entre `plantilla` y "todo lo
demás", y "todo lo demás" se reenvía con `client.enviarTexto(hilo.telefonoE164, mensaje.cuerpo)`.
Un saliente de media que llegase ahí **enviaría el PIE como un mensaje de texto suelto**: un
mensaje distinto del que el mensajero mandó, y sin el adjunto. Es exactamente la clase de fallo
silencioso que esta ficha existe para no repetir.

**Decisión: un saliente de adjunto NUNCA queda `queued`.** Un `transitorio` de la Graph API se
persiste `failed` con su motivo (R20), no `queued`, y no se encola job. Razón: el reintento
tardío tendría que reusar un `media_id` que **caduca en Meta**, y resubir es imposible porque —por
D3/R18— **no existe copia propia del binario**; el `File` vive solo en el navegador del mensajero
mientras la pestaña está abierta. Un job que reintenta con un id caducado gasta cuota, consume los
intentos y muere en dead-letter sin cambiar nada: el mismo argumento que ya documenta
`procesarFallo` (líneas 240-249) para los `failed` deterministas. **El reintento es del mensajero:
la burbuja fallida es visible y el adjunto sigue seleccionado (R19) o se vuelve a elegir.**

**Doble cinturón en `reintentarEnvio` (R21):** además de no encolar, se añade una guarda explícita
—si `mensaje.tipo` no es `texto` ni `plantilla`, se cierra como `failed` y se registra, **sin
llamar a `enviarTexto`**— para que un `queued` llegado por otra vía (un `failed` transitorio
devuelto a `queued` por `procesarFallo` desde un status del webhook, que es un camino REAL) no se
convierta en un texto espurio.

### 4.2 `persistirFalloPermanente` está tipado de menos

Su parámetro `base.tipo` es `"texto" | "plantilla"` (`ChatWhatsappService.ts:499-505`). Se
re-tipa a `ChatMensajeTipo` restringido a los tipos que el chat sabe EMITIR
(`"texto" | "plantilla" | TipoAdjuntoEnvio`) y gana los campos `media*` opcionales, para poder
persistir el fallo del paso 5 sin perder el `media_id` (que es lo que permite que la burbuja
fallida siga pudiendo mostrar el adjunto). `cuerpo` pasa de `string` a `string | null` porque una
nota de voz fallida no tiene cuerpo.

---

## 5. Server Action — `enviarMediaChat(formData)`

`lib/actions/chat-whatsapp.ts`. Es una mutación del propio proyecto ⇒ **Server Action**, no ruta
API (`docs/architecture.md`, tabla). Sería **la primera acción del chat que recibe `FormData`**;
el patrón ya existe en el repo y **se copia, no se inventa**: `reportarIncidente(formData)` en
`lib/actions/incidentes.ts` (líneas 222-233 y 288-304) con su `rawFromFormData` y su `FileLike`.

```ts
export async function enviarMediaChat(
  formData: FormData,
  deps: ChatWhatsappDeps = {},
): Promise<EnviarMediaChatResult>
```

**Campos del `FormData`:** `ordenId` (string), `caption` (string, opcional), `archivo` (File).
**No hay campo de tamaño ni de tipo declarados por el cliente** (R11): el tamaño sale de
`archivo.size` y el MIME de `archivo.type`, ambos del binario que efectivamente llegó.

**Puerta de autorización idéntica a `enviarMensajeChat`:**

1. `resolveActorFromSession()` → sin actor ⇒ `unauthenticated`, sin subir ni llamar a Meta (R26).
2. zod sobre `ordenId` y `caption` (`max(MAX_CAPTION)`, R12) ⇒ `forbidden` / `caption_largo`.
3. `ordenReader.findParaEnvio(ordenId, actor.usuarioId)` ⇒ `null` ⇒ `forbidden`, sin subir ni
   llamar a Meta (R27). **La propiedad de la orden se resuelve en el servidor contra la sesión,
   nunca por un parámetro del cliente.**
4. `validarAdjunto(archivo.type, archivo.size)` ⇒ `tipo_no_permitido` / `demasiado_grande` (R11).
5. `service.enviarMedia(...)`.

**Contrato de salida, en `lib/types/chat-whatsapp.ts`**, con la forma de
`EnviarMensajeChatResult` más los casos propios:

```ts
export type EnviarMediaChatResult =
  | { status: "ok"; mensajeChatId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "fuera_ventana" }          // R3
  | { status: "no_configurado" }
  | { status: "tipo_no_permitido" }                          // R9
  | { status: "demasiado_grande"; limiteBytes: number }      // R10, dice el límite
  | { status: "caption_largo"; maximo: number }              // R12
  | { status: "fallo_subida" }                               // R19: nada persistido
  | { status: "permanente"; mensajeChatId: string; detalle: string }; // R20
```

**No hay `transitorio`** a propósito (§4.1): un adjunto no se encola. Que el tipo lo omita hace
que el `switch` de la UI no pueda prometer un reintento que no existe.

**Tampoco hay `no_convertible` (R31), y es deliberado:** la normalización ocurre SOLO en el
navegador (§2.1), así que ese desenlace nunca lo produce el servidor —al que un HEIC le llega, si
le llega, como `tipo_no_permitido` (R9)—. Vive como estado del composer, no como `status` de la
acción. Meterlo en el union sería prometer un caso que el servidor no puede devolver.

---

## 6. UI

### 6.1 Composer (`ChatConversacion.tsx`)

El `<form>` actual (líneas ~455-509) gana, a la IZQUIERDA del `<textarea>`, un botón de clip que
abre un menú con las cuatro vías (R1). Cada vía es un `<input type="file">` oculto, salvo la nota
de voz:

| Vía | Disparador | `accept` / `capture` |
| --- | --- | --- |
| Cámara | input oculto | `accept="image/*,video/mp4,video/3gpp"` + `capture="environment"` |
| Archivo | input oculto | mismo `accept`, sin `capture` |
| Documento | input oculto | `accept` con los 5 MIME de documento + sus extensiones |
| Nota de voz | `getUserMedia` + `MediaRecorder` | — |

- **`disabled={!textoLibreHabilitado}`** en el botón de clip, exactamente el mismo booleano que ya
  gobierna el `<textarea>` (R2/D2), y el texto explicativo que ya se pinta debajo del form
  (líneas 500-508) gana la frase de que tampoco se pueden enviar adjuntos. **Se reusa el booleano
  del servidor, no se recalcula en el cliente**: el criterio vive en `listarHiloChat`.
- **Estado del composer:** `adjunto: { archivo: File; previewUrl: string | null; tipo:
  TipoAdjuntoEnvio } | null`. Con adjunto presente: se pinta la previsualización (imagen/vídeo) o
  el nombre + tamaño (documento/audio) con una `X` para quitarlo (R4), el `<textarea>` baja su
  `maxLength` a `MAX_CAPTION` (R12) y el placeholder pasa a "Añade un pie de foto…".
- **Envío:** un solo `enviar()`; si hay adjunto arma el `FormData` y llama a `enviarMediaChat`, si
  no, sigue por `enviarMensajeChat` (R5: **un solo mensaje**, nunca los dos).
- **R7:** un `useState` `enviando` deshabilita el botón de envío y el `onKeyDown` de Enter
  mientras la promesa está en vuelo. El `previewUrl` (`URL.createObjectURL`) se revoca al quitar
  el adjunto y al desmontar.
- **Tras `ok`:** se limpia el adjunto y se dispara la revalidación SWR del hilo, que es lo que
  hace aparecer la burbuja (R22). **Sin burbuja optimista** (fuera de alcance): una burbuja
  fantasma que luego desaparece es peor que 10 s de espera, y el hilo ya se refresca.
- **Tras un fallo:** `toast` con el motivo del `status` y **el adjunto se conserva** (R19).
- **Normalización + validación en cliente (R11/R29–R32):** en el `onChange` del input se ejecuta
  la secuencia de §2.1 —normalizar la imagen si hace falta, y solo entonces `validarAdjunto`—
  antes de subir un byte. `validarAdjunto` es la MISMA función pura que corre en el servidor: una
  sola definición de la política, dos puntos de aplicación. **La del cliente es cortesía de red;
  la del servidor es la defensa.** Mientras la conversión corre, el composer muestra "Preparando
  la foto…" y el botón de envío está deshabilitado (una foto de 12 MP tarda un momento en un móvil
  de gama baja, y sin ese estado parece que la app se colgó).
- **`accept` de la cámara y del archivo:** se deja `image/*` (no la lista blanca cerrada), porque
  con R29 el HEIC de iPhone **sí** se puede elegir; restringir el `accept` a `image/jpeg,image/png`
  le ocultaría al usuario de iOS sus propias fotos en el selector. La lista blanca se aplica
  DESPUÉS de normalizar, que es donde tiene sentido.
- **Aviso previo del límite de vídeo (D8/R10):** el menú de la cámara indica el tope de 16 MB
  ANTES de abrirla, para que el mensajero no descubra el rechazo con el vídeo ya grabado.

### 6.2 Nota de voz — `hooks/useGrabadorVoz.ts` (archivo nuevo)

**Es el riesgo principal de la feature y se trata de frente.** Chrome en Android graba
`audio/webm;codecs=opus` por defecto y **Meta no lo acepta como `type: audio`**. El hook NO asume
nada:

```ts
// Se MIDE el dispositivo, no se supone (R14).
export function formatoNotaVozSoportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return FORMATOS_NOTA_VOZ.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}
```

`FORMATOS_NOTA_VOZ` (§2), en orden de preferencia y **todos aceptados por Meta**:
`audio/ogg;codecs=opus` → `audio/ogg` → `audio/mp4` → `audio/aac` → `audio/mpeg`.

> **Corrección aplicada tras la revisión (2026-08-28).** Esta lista y la tabla de §2 se
> contradecían: el primer elemento lleva el parámetro de codec (`;codecs=opus`) y la tabla
> de `MIMES_ENVIO` guarda **MIME base**, así que el assert (e) de A1 —«todos los elementos de
> `FORMATOS_NOTA_VOZ` están en `MIMES_ENVIO.audio`»— era **imposible de satisfacer
> literalmente**. Lo cierto, y lo que el código hace, es que `clasificarAdjunto` **normaliza
> el MIME** (minúsculas y sin parámetros) antes de comparar: `audio/ogg;codecs=opus` →
> `audio/ogg`, que sí está en la tabla. Sin esa normalización una nota de voz en ogg —formato
> que Meta **sí** acepta— se habría rechazado como `tipo_no_permitido`, es decir, la feature
> se rompía sola. El assert vive sobre el MIME base y conserva la regresión que importa:
> ningún formato de la lista empieza por `audio/webm`, que es el que Meta no admite.
El `mimeType` con el que se construye el `MediaRecorder` es el que devuelve esa función, y el
`File` que se sube lleva **el `recorder.mimeType` real** (no el pedido), reclasificado con
`clasificarAdjunto`: si el navegador devolviera algo distinto de lo pedido, se detecta en el
mismo camino que cualquier otro archivo, no por un supuesto.

**Si la función devuelve `null` (R15):** la vía "nota de voz" del menú se pinta **deshabilitada**
con el texto "La nota de voz no está disponible en este navegador", y las otras tres siguen. No
se graba, no se sube, no se envía nada que el cliente no pueda escuchar.

**Alternativa evaluada y NO elegida (P1, CERRADA por el humano el 2026-08-28 a favor de lo de
arriba): enviar el `webm` como `document`.** Llegaría siempre, pero el cliente recibiría un
archivo que su WhatsApp puede no reproducir y el mensajero creería haber mandado una nota de voz.
**No hay dato en el repo que diga si se reproduce**, así que elegirla habría sido exactamente el
supuesto no medido que la 311 documenta haber pagado caro. Transcodificar a ogg/mp3 en el
navegador (wasm) se descarta por peso y por estar fuera de alcance.

**Por qué el `<canvas>` de §2.1 no rescata este caso:** aquel camino funciona porque el navegador
que produce HEIC es el mismo que sabe decodificarlo, y el decodificador ya está en el navegador.
Con el audio no hay equivalente: `MediaRecorder` no ofrece "grábame en un formato que no
soportas", y re-encodear PCM a AAC/Opus a mano es traer un codec en wasm. Son problemas distintos
aunque suenen parecidos.

**Permisos (R16):** `getUserMedia` rechazado ⇒ estado `sin_permiso` con texto explícito y vuelta
al composer. El `MediaStream` se para (`getTracks().forEach(t => t.stop())`) al detener, al
descartar y al desmontar: dejar el micro abierto enciende el indicador del sistema
indefinidamente.

**Antes de enviar (R13):** se ofrece `<audio controls src={objectUrl}>` para escucharla y un botón
de descartar.

### 6.3 `MediaAdjunto.tsx` — parametrizar por dirección (R23)

Hoy los textos accesibles están cableados a "del cliente": `"Imagen enviada por el cliente"`
(línea 147), `"Sticker enviado por el cliente"` (146), `"Nota de voz del cliente"` /
`"Video enviado por el cliente"` (194). **Con salientes eso pasa a ser FALSO.** Se añade la prop
`direccion: ChatMensajeDireccion` y los textos se resuelven con un mapa
`textoAccesible(tipo, direccion)` en `chat-format.ts`:

| tipo | entrante | saliente |
| --- | --- | --- |
| imagen | Imagen enviada por el cliente | Imagen que enviaste |
| sticker | Sticker enviado por el cliente | Sticker que enviaste |
| audio | Nota de voz del cliente | Nota de voz que enviaste |
| video | Video enviado por el cliente | Video que enviaste |

Los textos de reintento (`"Reintentar la descarga de la imagen"`…) no citan al autor y **no
cambian**.

**`BurbujaContenido.tsx` NO se toca:** su `switch` es por `mensaje.tipo` y no mira `direccion`, y
`ChatConversacion.Burbuja` ya pinta salientes a la derecha con sus acuses. Solo pasa `direccion`
hacia abajo.

### 6.4 Proxy de media: **verificado, no se toca** (R24/R25)

`app/api/chat/media/[mensajeId]/route.ts` autoriza con
`findMediaParaMensajero(mensajeId, mensajeroId)`, cuyo contrato
(`IChatMensajeRepository.ts:152-164`) resuelve por la orden asignada al mensajero y **no filtra
por `direccion`**. `ChatMensajeVista`/`ChatMediaVista` ya llevan `direccion` y `media`, y
`listarHiloChat` ya mapea `media` **sin el `media_id` de Meta**
(`lib/actions/chat-whatsapp.ts:270-273`). Por tanto un saliente se sirve, se pinta y expira
(410 → "Este archivo ya no está disponible.") con cero cambios. Se verifica con un test, no con
una lectura.

---

## 7. Seguridad y PII (R28)

- Ni la acción, ni el service, ni el cliente de subida loguean el binario, el nombre del archivo,
  el pie, el número destino ni el token. Los detalles de error citan la OPERACIÓN y el código HTTP
  (invariante 3 heredada de `whatsapp-cloud.ts`/`whatsapp-media.ts`).
- **Cuidado con el volcado existente:** `enviar()` vuelca el cuerpo de la petición con
  `cuerpoParaLog` (línea 145-148). El cuerpo de `enviarMedia` lleva `caption` (texto del
  mensajero) y `filename`; **ambos se redactan** en `cuerpoParaLog`, igual que ya se redacta el
  destinatario. Se fija con un assert, porque es el punto donde el PII se escapa sin querer.
- El `media_id` de Meta **no cruza a la UI** en ninguna dirección (el contrato ya lo impide).
- El binario **no se escribe en disco ni en la base**: viaja del `FormData` de la Server Action al
  `FormData` de la Graph API. R18/D3 queda por construcción, no por disciplina.
- Cuota/timeout: el cliente de subida usa `AbortSignal.timeout` con un valor propio y más generoso
  que el de envío (`TIMEOUT_SUBIDA_MS`, en `chat-media-envio.ts`), por la misma razón que
  `TIMEOUT_MEDIA_MS` de la descarga: sube un binario por la red móvil del repartidor.

---

## 8. Alternativas descartadas

1. **Guardar el binario en Supabase Storage y enviarlo a Meta por URL** (`link` en vez de `id`).
   Descartada por D3/R18 (decisión humana cerrada, que además mantiene viva D1/R15 de la 311):
   implicaría bucket, política de acceso, cron de purga y PII binaria en reposo bajo nuestra
   custodia. **Y tiene un coste extra que no se ve a primera vista:** un envío por `link` exige que
   la URL sea PÚBLICA para que Meta la descargue, lo que obligaría a exponer media del cliente sin
   sesión —justo lo que la alternativa 5 de la 311 ya descartó— o a firmar URLs temporales. El
   precio de no guardar nada es que a los 30 días el adjunto propio caduca, y eso se cubre con R25.
2. **Reusar `whatsapp-cloud.ts::enviar()` para la subida con un flag `multipart`.** Descartada:
   ese método fija `Content-Type: application/json` y serializa con `JSON.stringify`, y en
   multipart el `Content-Type` con `boundary` lo tiene que poner el runtime. El flag partiría en
   dos un método que hoy tiene una sola forma y rompería su volcado de petición. Cliente aparte,
   igual que ya lo está la descarga (`whatsapp-media.ts:1-16`).
3. **Ampliar `lib/config/chat-media.ts` con los límites de subida.** Descartada: es política de
   SERVIDO. Un lector futuro que tomara `MIMES_INCRUSTABLES` como whitelist de subida rompería
   PDF/vídeo/audio, y quien tomara la whitelist de subida como política de servido volvería
   incrustable un PDF. Archivo aparte con la razón escrita en su cabecera.
4. **Encolar reintento del saliente de media, como se hace con texto y plantilla.** Descartada
   (§4.1): el `media_id` caduca y no hay copia propia del binario para resubir, así que el
   reintento fallaría siempre y moriría en dead-letter. Se persiste `failed` con motivo visible y
   el reintento es del mensajero.
5. **Enviar el pie como un mensaje de TEXTO aparte, justo antes del adjunto.** Descartada por D4:
   son dos mensajes donde WhatsApp muestra uno, duplican acuses y notificaciones, y si el segundo
   falla el cliente recibe un texto huérfano que habla de una foto que nunca llegó.
6. **Validar solo en el cliente** (el servidor confía en lo que le mandan). Descartada por R11:
   una Server Action es un endpoint HTTP; el `disabled` de un botón no es una defensa. La
   validación se comparte como función PURA y se ejecuta en los dos lados.
7. **Ruta API `POST /api/chat/media` para la subida** en vez de Server Action. Descartada por
   `docs/architecture.md`: es una mutación interna del propio proyecto disparada por un componente
   propio ⇒ Server Action. Además obligaría a duplicar la puerta de autorización que
   `enviarMensajeChat` ya tiene resuelta.
8. **Burbuja optimista** con el `objectURL` local mientras sube. Descartada: obligaría a conciliar
   una burbuja falsa con la real del refresco, y a inventar un id de mensaje que el proxy no puede
   autorizar. El hilo ya se refresca; el estado "enviando" vive en el composer, que es donde el
   mensajero está mirando.
9. **Rechazar la foto HEIC con un aviso** (lo que decía el borrador antes de la puerta).
   Descartada por D7: en un iPhone equivale a rechazar la cámara del teléfono, que es el gesto
   principal de la feature.
10. **Escribir un helper de canvas nuevo para la 316.** Descartada: ya existe
    `lib/utils/comprimir-imagen.ts`, con la orientación EXIF resuelta y cuatro superficies
    usándolo. Duplicarlo sería mantener dos veces el mismo bug de orientación (§2.1).
11. **Refactorizar `comprimir-imagen.ts` a un núcleo compartido con dos políticas de fallo**
    (opción (b) del humano). Descartada: toca cuatro superficies de producción que hoy funcionan
    **y que no tienen ni un test**; se prefiere una opción aditiva con default histórico (§2.1).
12. **Normalizar la imagen en el SERVIDOR** (sharp / libheif). Descartada: metería una dependencia
    binaria pesada en el bundle de la Server Action para resolver en Vercel lo que el propio
    iPhone ya sabe hacer gratis, y no evitaría subir el HEIC por la red móvil del mensajero.

---

## 9. Riesgos declarados

- **La nota de voz sigue siendo el riesgo principal**, pero su salida ya está cerrada (P1→D5/R15):
  sin formato aceptado, no se ofrece. Lo que se mide en el dispositivo es qué formato hay, y eso
  lo hace el código, no un supuesto.
- **La normalización de imagen depende del decodificador del navegador.** El diseño se apoya en
  que quien produce HEIC (Safari/iOS) es quien sabe decodificarlo; si un navegador entregara un
  formato que no sabe decodificar, `comprimirImagen` devuelve el original y el post-chequeo de MIME
  lo convierte en el rechazo explícito de R31. **Degradación prevista, no sorpresa.**
- **`comprimir-imagen.ts` entra en un camino crítico sin tener tests hoy.** Deja de ser una
  optimización best-effort (donde fallar en silencio no dolía) y pasa a decidir si una foto de
  iPhone se envía. Por eso el bloque A de `tasks.md` le añade tests **del comportamiento del que
  la 316 depende** —conversión a `image/jpeg`, HEIC pequeño, `toBlob` nulo y el default
  `devolverOriginalSiMayor` que protege a las 4 superficies existentes—, no una cobertura completa
  del helper.
- **Memoria en el móvil:** decodificar una foto de 12 MP son ~48 MB de bitmap. Mitigado con el
  redimensionado a 1600 px y `bitmap.close()`, que ya hace el helper. En un móvil de gama muy baja
  puede fallar; ese fallo cae en el `catch` → R31 (aviso claro), no en un cuelgue.
- **Vídeo de cámara > 16 MB** es fácil de producir en menos de un minuto: se rechaza tras grabar
  (D8). El aviso del límite se pinta ANTES de abrir la cámara para reducirlo. **No se recomprime**
  (§2.1, último párrafo).
- **Documento por red móvil:** el tope propio de 25 MB (D6) vive en `LIMITE_DOCUMENTO_BYTES`, una
  constante única, para poder subirlo o bajarlo en una línea.
- **S1 (supuesto sin medir):** qué `File.type` entrega iOS por la vía cámara frente a "Examinar".
  El comportamiento no depende de ello (§2.1); ver `requirements.md > Preguntas abiertas`.
- `procesarFallo` puede devolver a `queued` un saliente `failed` transitorio desde un status del
  webhook: por eso la guarda de `reintentarEnvio` (§4.1) es obligatoria y no "defensa por si
  acaso".
