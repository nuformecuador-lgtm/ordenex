# Feature 299 — Design

> Decisiones técnicas. Extiende el chat de las features 109/120/121; todo lo que aquí no se
> redefine se hereda sin cambios (firma HMAC del webhook, scope por mensajero, ventana de 24 h,
> polling SWR, RLS de las tablas de chat). El precedente estructural es la feature 121, que
> añadió un tipo nuevo de punta a punta (enum → zod → repo → service → action → burbuja); esta
> feature repite ese camino para siete tipos más, una tabla-menos y una ruta nueva.

## 0. Principio rector

Extensión **aditiva**: valores nuevos de enum, columnas nullable, ramales nuevos en el
normalizador del webhook, campos nuevos en el contrato Server Action→UI, componentes de burbuja
nuevos y **una** ruta privada de proxy. **No se crean tablas** (por tanto no hay RLS nueva), no
se crean buckets, no se crean jobs ni crons. Regla anti-sobre-ingeniería de `architecture.md`.

---

## 1. Modelo de datos y migración

### 1.1 Enum `ChatMensajeTipo` (`chat_mensaje_tipo`, `db/schema.prisma:248`)

Hoy: `texto | plantilla | otro | ubicacion`. Se añaden **ocho** valores:

`imagen`, `audio`, `video`, `documento`, `sticker`, `reaccion`, `contactos`, `sistema`.

`otro` se CONSERVA como sumidero: sigue siendo el destino de los tipos fuera de alcance, de los
desconocidos y de las degradaciones (R3/R6/R8/R11).

### 1.2 Columnas nuevas en `ChatMensaje` (`chat_mensaje`)

Todas **nullable**, todas pobladas solo por el tipo que las usa:

| Columna Prisma | Columna SQL | Tipo | Para |
| --- | --- | --- | --- |
| `mediaId` | `media_id` | `TEXT?` | id de media de Meta (R1). Único dato que permite bajar el binario |
| `mediaMime` | `media_mime` | `TEXT?` | `mime_type` de Meta (R1). Decide inline vs descarga (R25) |
| `mediaNombre` | `media_nombre` | `TEXT?` | `filename` de documentos (R1/R29) |
| `mediaTamanoBytes` | `media_tamano_bytes` | `INTEGER?` | `file_size` **si** Meta lo manda; normalmente NULL (P2) |
| `reaccionAWaMessageId` | `reaccion_a_wa_message_id` | `TEXT?` | `reaction.message_id`: mensaje reaccionado (R4) |
| `reaccionEmoji` | `reaccion_emoji` | `TEXT?` | emoji; **NULL = reacción retirada** (R5) |
| `contactosJson` | `contactos_json` | `JSONB?` | payload normalizado de `contacts` (R7) |
| `sistemaTelefonoAnterior` | `sistema_telefono_anterior` | `TEXT?` | número previo del cambio (R9/R18) |
| `sistemaTelefonoNuevo` | `sistema_telefono_nuevo` | `TEXT?` | número nuevo del cambio (R9/R18) |

Índice nuevo: `@@index([conversacionId, reaccionAWaMessageId])` — el agregado de reacciones
(R19) lee todas las reacciones de un hilo por su objetivo; sin índice sería un scan del hilo.
El listado del hilo ya tiene `@@index([conversacionId, ocurridoAt])`.

**El pie de foto (`caption`) NO tiene columna:** va a `cuerpo` (R2), que es exactamente lo que
`cuerpo` significa hoy (texto plano del mensaje). Así la linkificación (R33) funciona gratis
sobre el caption de una imagen.

### 1.3 Columnas propias vs un único JSON — decisión y justificación

**Se eligen columnas propias para media, reacción y sistema; JSON solo para `contacts`.**

- **Media/reacción/sistema** son campos **escalares, de aridad fija y consultables**. `media_id`
  lo lee la ruta proxy en la ruta caliente; `reaccion_a_wa_message_id` es criterio de JOIN/agrupación
  para el agregado; los dos teléfonos del cambio de número son evidencia auditable. Meterlos en un
  JSON obligaría a `->>` en cada consulta, impediría el índice de 1.2 y —lo importante en un repo
  `strict`— haría que el tipo Prisma fuera `Prisma.JsonValue`, es decir, una variante que hay que
  desempaquetar con casts en cada lectura.
- **`contacts` es lo contrario**: estructura **anidada y de aridad variable** (N contactos × N
  teléfonos × N correos × N direcciones). Normalizarlo en columnas exigiría 3–4 tablas hijas para
  un dato que solo se lee entero, para pintarlo. Va a `JSONB`.
- **El JSON no cruza la frontera como `Json`/`any`.** Se define
  `chatContactosSchema` (zod) en `lib/types/chat-contactos.ts` con el tipo
  `ChatContactoNormalizado[]` inferido. Se valida **al escribir** (borde del webhook) y **al leer**
  (mapeo del DTO a `ChatMensajeVista`), con `safeParse`: un JSON histórico o corrupto degrada a
  "sin contactos" en vez de reventar el hilo. En ningún punto se usa `any` ni
  `dangerouslySetInnerHTML` sobre ese payload.

### 1.4 Migración `db/migrations/<ts>_chat_mensaje_media_reacciones/`

- **`migration.sql` (UP):**
  - `ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS '<v>';` × 8.
  - `ALTER TABLE "chat_mensaje" ADD COLUMN ...` × 9 (todas nullable, sin default).
  - `CREATE INDEX IF NOT EXISTS "chat_mensaje_reaccion_idx" ON "chat_mensaje" ("conversacion_id", "reaccion_a_wa_message_id") WHERE "reaccion_a_wa_message_id" IS NOT NULL;` (índice PARCIAL; en el schema se declara el btree equivalente con `map:` explícito, mismo apaño y misma razón que `chat_mensaje_error_codigo_idx`).
  - **GOTCHA documentado en el .sql (precedente 121/106):** Postgres no permite USAR un valor de
    enum en la misma transacción que lo añadió (55P04). Aquí solo se DECLARAN; el primer uso son
    los inserts del webhook, en transacciones posteriores. `IF NOT EXISTS` lo hace idempotente.
- **`down.sql` (DOWN, obligatorio):** `DROP INDEX` + `DROP COLUMN IF EXISTS` × 9 + recreación del
  enum sin los ocho valores (rename a `_old` → `CREATE TYPE` con los cuatro valores actuales →
  `ALTER COLUMN tipo TYPE ... USING (tipo::text::...)` → `DROP TYPE _old`), patrón idéntico al
  down de la 121. **Precondición documentada:** ninguna fila con los tipos nuevos; si la hubiera,
  el `USING` falla ruidosamente, que es el comportamiento correcto (no se revierte borrando
  mensajes del cliente sin intervención explícita).

### 1.5 Histórico (R14) — declaración explícita

Los entrantes ya guardados como `otro` **no se pueden reconstruir**: el payload crudo de Meta no
se persiste (zod hace strip y el route handler solo conserva el texto crudo el tiempo de validar
la firma), y aunque se persistiera, el binario de Meta ya habría caducado a los 30 días. Por
tanto:

- **No hay backfill.** La migración no reinterpreta ninguna fila existente.
- Esas filas **siguen siendo `otro`** y la UI las pinta con el aviso "Mensaje no compatible" en
  vez de la burbuja vacía de hoy (R14/R27). El arreglo del síntoma es retroactivo; el dato, no.

---

## 2. Borde tipado del webhook (`lib/types/whatsapp-webhook.ts`)

Punto de entrada. Se conserva **entero** el patrón vigente: `.optional().catch(undefined)` en todo
lo blando, strip por defecto, y degradación a `otro` cuando falta lo esencial. **Ninguna rama
lanza**; el lote y el `200` siguen garantizados (R11).

### 2.1 `metaMessageSchema` — campos nuevos

```
const metaMediaSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().optional().catch(undefined),
  filename: z.string().optional().catch(undefined),   // solo documentos
  caption: z.string().optional().catch(undefined),    // image/video/document
  file_size: z.number().int().nonnegative().optional().catch(undefined), // rara vez viene (P2)
}).optional().catch(undefined);
```

- `image`, `audio`, `video`, `document`, `sticker` → cada uno con `metaMediaSchema`.
- `reaction: z.object({ message_id: z.string().min(1), emoji: z.string().optional().catch(undefined) }).optional().catch(undefined)`
- `contacts: z.array(metaContactSchema).optional().catch(undefined)` con
  `metaContactSchema = z.object({ name: {...}, phones: [...], emails: [...], addresses: [...], org: {...}, urls: [...] })`,
  todos sus miembros `.optional().catch(undefined)` (Meta ha cambiado la forma más de una vez).
- `system: z.object({ type: z.string().optional().catch(undefined), body: ..., wa_id: ..., new_wa_id: ..., customer: ... }).optional().catch(undefined)`

**Por qué `.catch(undefined)` y no `.optional()` a secas:** es exactamente el motivo que ya
documenta `location` (líneas 21-29 del archivo): un tipo inesperado hace fallar ESE campo y el
`.catch` lo degrada a "sin dato" en vez de tumbar el `parse` del lote entero, que devolvería el
`200` por el `catch` del route handler pero **perdiendo todos los mensajes del lote**.

### 2.2 `tipoDeMeta` y `parseWebhookEventos`

`tipoDeMeta` pasa de tres `if` a un `Record<string, ChatMensajeTipo>` explícito:
`text→texto`, `location→ubicacion`, `image→imagen`, `audio→audio`, `video→video`,
`document→documento`, `sticker→sticker`, `reaction→reaccion`, `contacts→contactos`,
`system→sistema`; **default `otro`** (cubre `button`, `interactive`, `order`,
`request_welcome`, `ephemeral` y cualquier tipo futuro, R11).

`parseWebhookEventos` gana, junto al ramal de `ubicacion` ya existente, tres helpers **puros y
testeables** (mismo molde que `esCoordenadaValida`):

- `normalizarMedia(m)` → `{ mediaId, mediaMime, mediaNombre, mediaTamanoBytes } | null`. `null`
  ⇒ degradación a `otro` (R3). Además fija `cuerpo = caption ?? null` (R2).
- `normalizarReaccion(m)` → `{ objetivoWaMessageId, emoji: string | null } | null`. Emoji
  `""`/ausente ⇒ `emoji: null` = **retirada** (R5). Sin `message_id` ⇒ `null` ⇒ `otro` (R6).
- `normalizarSistema(m)` → `{ telefonoAnterior, telefonoNuevo } | null`. Nuevo =
  `system.wa_id ?? system.new_wa_id ?? system.customer`, normalizado con
  `normalizarTelefonoWa`; anterior = `m.from` normalizado. Sin nuevo ⇒ `null` ⇒ degradación
  (R10). Se aceptan los TRES nombres que ha usado la Cloud API para este evento:
  `"user_changed_number"` (antiguo), `"customer_changed_number"` (vigente) y
  `"customer_identity_changed"`. **No se casa contra un literal unico A PROPOSITO**: el repo
  apunta a `v21.0` (`lib/config/whatsapp.ts:10`), donde el evento NO se llama
  `user_changed_number`, asi que exigir ese literal dejaria R9 muerto en silencio y ningun test
  lo delataria, porque los tests usan el mismo payload supuesto. El criterio es el NUMERO, no el
  nombre: subtipo entre esos tres + numero nuevo determinable => se normaliza; cualquier otro
  subtipo de `system` degrada a `otro` (fuera de alcance). **Ver P1**.
- `normalizarContactos(m)` → `ChatContactoNormalizado[] | null`. Lista vacía o no parseable ⇒
  `null` ⇒ `otro` (R8).

`WebhookMensajeEntrante` se extiende con sub-objetos **opcionales y cohesivos** (misma razón que
`ubicacion?`: o viene el grupo entero o ninguno): `media?`, `reaccion?`, `contactos?`,
`sistema?`.

---

## 3. Service (`lib/services/ChatWhatsappService.ts`)

`ingerirEventos` conserva su forma: resolver hilo → insertar idempotente → sellar ventana. Dos
añadidos:

1. **Propagación de los campos nuevos** al `insertarEntranteIdempotente` (igual que la 121 hizo
   con lat/lng). Dedupe por `wa_message_id` y sellado de `ultimo_entrante_at` **no se tocan**
   (R12): una reacción o un sticker es un entrante más.
2. **Cambio de número (R16/R17/R18)**, ANTES de resolver la orden por número: si el mensaje es
   `sistema` con `telefonoNuevo`, se invoca
   `conversacionRepo.migrarTelefono(anterior, nuevo)` (nuevo método del repo, `UPDATE
   chat_conversacion SET telefono_e164 = $nuevo WHERE telefono_e164 = $anterior`), y después se
   resuelve/inserta el entrante `sistema` en el hilo **ya migrado**, con sus dos teléfonos como
   evidencia persistente.
   - **`ON CONFLICT DO NOTHING` sobre `@@unique([ordenId, telefonoE164])`**: si ya existe hilo de
     esa orden con el número nuevo, la fila no se migra; el evento se registra igual como
     evidencia en el hilo que sí resolvió y la ingesta continúa (R18, degradación de P5). El
     método devuelve el número de filas migradas, que el resumen de ingesta cuenta.
   - **Idempotencia:** el `sistema` es un mensaje más con `wa_message_id`, así que el dedupe de
     la 109 impide la evidencia duplicada ante un reenvío de Meta (R18).
   - **No se toca `orden` ni `cliente`** (R17): el service solo tiene inyectados los repos de
     chat; no hay forma de escribir en el maestro desde aquí, y así queda por construcción.
   - **La migración es SOLO EVIDENCIA, no continuidad** (bloque «LIMITACIÓN CONOCIDA» bajo R16 en
     `requirements.md`, decisión del humano del 2026-08-27): migrar el hilo **no** hace que los
     mensajes posteriores del cliente lleguen. Un entrante se resuelve a su orden por
     `orden.telefono_dest` (`resolverOrdenActivaPorNumero`), no por el `telefono_e164` del hilo,
     y R17 prohíbe tocar ese campo; así que un mensaje enviado desde el número NUEVO cuenta como
     `sinResolver`, el webhook responde `200` y no llega a nadie. Fijado con un `assert` en
     `tests/unit/services/chat-whatsapp-service.test.ts`.

`IngestaResumen` gana `hilosMigrados: number` (conteo agregado, sin PII).

---

## 4. Repositorio (`lib/repositories/ChatMensajeRepository` + `ChatConversacionRepository`)

- `InsertarEntranteInput` y `ChatMensajeDTO` (en `lib/interfaces/repositories/IChatMensajeRepository.ts`)
  se extienden con los nueve campos nuevos (`mediaId`, `mediaMime`, `mediaNombre`,
  `mediaTamanoBytes`, `reaccionAWaMessageId`, `reaccionEmoji`, `contactos`,
  `sistemaTelefonoAnterior`, `sistemaTelefonoNuevo`). `contactos` cruza la interfaz **tipado**
  (`ChatContactoNormalizado[] | null`), no como `Json`: la conversión JSON↔tipo vive en el repo.
- `SELECT`/`Row`/`toDTO` incluyen las columnas nuevas; los salientes las dejan `null`.
- `IChatConversacionRepository` gana `migrarTelefono(anterior, nuevo): Promise<number>`.
- `findMediaParaMensajero(mensajeId, mensajeroId)`: **una sola query** que devuelve
  `{ mediaId, mediaMime, mediaNombre, ordenId }` solo si el mensaje pertenece a un hilo de una
  orden asignada a ese mensajero. Es la pieza que hace barata la autorización del proxy sin
  duplicar reglas (ver §5.2).

---

## 5. Ruta proxy de media

### 5.1 Forma de la URL y método

```
GET /app/api/chat/media/[mensajeId]/route.ts     →  GET /api/chat/media/<uuid-del-mensaje>
                                                     ?descarga=1   (opcional)
```

- **Se identifica por el id INTERNO del `ChatMensaje` (uuid), nunca por el media id de Meta.**
  Dos razones: (a) el id interno es autorizable —de él se llega a conversación → orden →
  mensajero asignado—, mientras que un media id de Meta es un identificador global sin dueño en
  nuestro modelo; (b) el media id no aparece nunca en una URL, un log de acceso ni el historial
  del navegador (R21/R35).
- `GET` (es una lectura, cacheable por el navegador con `private`), route handler porque es
  entrega de un **binario**, no una mutación: las Server Actions no son la herramienta para eso
  (`architecture.md`, tabla Server Actions vs Route Handlers).
- `export const runtime = "nodejs"` (Prisma + sesión).

### 5.2 Autorización — MISMA regla que `listarHilo`

1. `resolveActorFromSession()` → sin actor ⇒ **401**, sin tocar la Graph API (R22).
2. `findMediaParaMensajero(mensajeId, actor.usuarioId)` ⇒ `null` (mensaje inexistente, de otro
   hilo, o de una orden no asignada a ese mensajero) ⇒ **403**, sin tocar la Graph API (R23).
   Es la misma puerta que R16/R17 de la 109: la propiedad de la orden, resuelta en el servidor
   contra la sesión, nunca por un parámetro del cliente.
3. `mediaId === null` (mensaje sin media) ⇒ **404**.

**Middleware / guardia 229 (R26):** la ruta **no se añade a `PUBLIC_ROUTES` ni a
`SELF_AUTH_ROUTES`**. `/api/chat/media/...` no casa con ninguna entrada de esas listas, así que
el guard de sesión la cubre por defecto (307 a `/login` sin cookie) y la guardia 229, que compara
`PUBLIC_ROUTES` posicionalmente contra una lista firmada, **no se roza**. La autorización real
(propiedad de la orden) vive igualmente en el handler: el middleware solo comprueba sesión.

### 5.3 Descarga desde Meta — streaming, no buffer

Cliente nuevo `lib/clients/whatsapp-media.ts` (mismo molde que `whatsapp-cloud.ts`: `fetchImpl`
inyectable, `AbortSignal.timeout`, token solo en la cabecera `Authorization: Bearer`, errores que
citan la OPERACIÓN y el código HTTP, nunca el token ni el número):

1. `GET https://graph.facebook.com/<version>/<media-id>` → `{ url, mime_type, file_size }`
   (validado con zod).
2. `GET <url>` con `Authorization: Bearer` → respuesta binaria.
3. El handler devuelve `new Response(res.body, { headers })` — **se hace passthrough del
   `ReadableStream`, no se bufferiza**: un vídeo de WhatsApp llega hasta ~16 MB (y un documento
   hasta 100 MB) y bufferizarlo en una función serverless es memoria y latencia por nada.

**Desenlace tipado** (`WhatsappMediaOutcome`), calcado del `WhatsappEnvioOutcome`:
`{ status:"ok", cuerpo, mime, tamano }` | `{ status:"expirado" }` | `{ status:"error", detalle }`.
`expirado` se deriva de **404 de Meta**, o de `error.code === 100` con subcódigo de objeto
inexistente, o de una `url` vacía: esos tres son los desenlaces observados cuando el binario ya
no existe (R24).

### 5.4 Cabeceras de la respuesta

| Cabecera | Valor |
| --- | --- |
| `Content-Type` | el MIME de Meta **si** está en la lista segura; si no, `application/octet-stream` |
| `Content-Disposition` | `inline` para la lista segura sin `?descarga=1`; `attachment; filename="<saneado>"` en el resto y siempre con `?descarga=1` (R25) |
| `X-Content-Type-Options` | `nosniff` (siempre) |
| `Cache-Control` | `private, max-age=300, no-store` en el caso de descarga; nunca `public` |
| `Content-Length` | passthrough del de Meta cuando viene |

**Lista segura para incrustar:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`,
`audio/*`, `video/*`. **`image/svg+xml` queda FUERA a propósito** (un SVG es scriptable: servirlo
`inline` desde nuestro origen sería XSS almacenado con el cliente como atacante). Todo lo demás
—PDF incluido— se sirve como descarga con `octet-stream`.
El `filename` se sanea: se eliminan `"`, `\`, `\r`, `\n` y separadores de ruta, se recorta a 100
caracteres y se cae a `adjunto` si queda vacío (evita inyección de cabecera).

**Códigos:** `200` ok · `401` sin sesión · `403` orden ajena · `404` mensaje sin media ·
**`410 Gone`** con cuerpo JSON `{ "error": "expirado" }` cuando Meta ya no tiene el binario (R24;
`410` es literalmente "estuvo aquí y ya no está") · `502` cuando la Graph API falla por otra
causa.

---

## 6. Contrato Server Action → UI

`ChatMensajeVista` (`lib/types/chat-whatsapp.ts`) se extiende:

```ts
interface ChatMensajeVista {
  // ...campos actuales (id, direccion, tipo, cuerpo, estado, latitud, longitud, ocurridoAt)
  media: { mime: string | null; nombre: string | null; tamanoBytes: number | null } | null;
  contactos: ChatContactoNormalizado[] | null;
  sistema: { telefonoAnterior: string | null; telefonoNuevo: string | null } | null;
  reacciones: { emoji: string; conteo: number }[];   // vacío = sin reacciones
}
```

- **`media` NO lleva el media id de Meta** (R21/R35): la UI construye la URL con
  `/api/chat/media/${mensaje.id}`, que es el id interno que ya tiene.
- **Agregado de reacciones (R19/R20), en `listarHiloChat`:** las filas `tipo === "reaccion"` se
  SACAN de la lista de burbujas y se indexan por `reaccionAWaMessageId`; para cada objetivo se
  conserva la **última por `ocurridoAt` y autor** (autor = dirección del mensaje; ver P4) y se
  descarta si su `reaccionEmoji` es `null` (retirada, R5/R20). El resultado se cuelga del mensaje
  cuyo `waMessageId` coincide. Una reacción cuyo objetivo no está en el hilo (mensaje anterior al
  chat, o ya purgado) se descarta silenciosamente: no genera burbuja huérfana.
- El agregado es una **función pura** `agregarReacciones(mensajes)` en
  `lib/utils/chat-reacciones.ts` → testeable sin DB ni sesión, y reusable si mañana el resumen
  de no leídos necesita ignorarlas.
- **No leídos:** las reacciones son entrantes y hoy cuentan como no leídos. Se deja así (no es
  alcance de esta ficha) y se anota; el conteo no cambia de semántica.

---

## 7. UI (`app/(app)/mis-asignaciones/_components/chat/`)

`ChatConversacion.tsx` deja de ramificar `esUbicacion` vs `<p>` y delega en un componente nuevo
**`BurbujaContenido.tsx`** con un `switch` exhaustivo sobre `ChatMensajeTipo` (el `switch`
exhaustivo con `never` en el default es lo que hace que añadir un tipo futuro sin pintarlo sea un
error de compilación, no otra burbuja vacía).

| Archivo nuevo | Qué pinta |
| --- | --- |
| `BurbujaContenido.tsx` | switch por tipo; `otro` → "Mensaje no compatible" (R14/R27) |
| `TextoConEnlaces.tsx` | texto + linkificación (R33/R34) |
| `MediaAdjunto.tsx` | imagen/sticker (preview), audio/vídeo (reproductor), documento (descarga) |
| `TarjetaContacto.tsx` | datos del contacto + copiar por dato (R31) |
| `Reacciones.tsx` | chips de emoji anclados a la burbuja (R30) |
| `BurbujaSistema.tsx` | fila centrada, distinta de entrante/saliente (R32) |
| `hooks/useMediaChat.ts` | fetch del proxy → object URL, o estado `expirado` (R24) |

- **`useMediaChat`** hace `fetch("/api/chat/media/<id>")` (same-origin, la cookie viaja sola),
  distingue `410` → estado `expirado` y `ok` → `URL.createObjectURL`, y revoca el object URL al
  desmontar. **Se usa `fetch` y no `<img src>` directo a propósito:** el `onError` de un `<img>`
  no distingue "caducado" de "sin red", y R24 exige el mensaje explícito.
- **Cuándo se baja (P3):** imagen y sticker cargan al montar la burbuja; audio, vídeo y documento
  esperan a una acción explícita del mensajero. Sin esto, cada refresco SWR de 10 s podría
  disparar descargas de vídeo por la red móvil del repartidor.
- **Expiración (R24):** el estado `expirado` pinta el texto "Este archivo ya no está disponible
  (WhatsApp lo elimina a los 30 días)" dentro de la burbuja, con el icono en `aria-hidden`. No es
  un `toast`: el aviso pertenece al mensaje y debe seguir ahí al volver a mirarlo.
- **Accesibilidad (R28/R29/R31):** `alt` = caption si lo hay, si no "Imagen enviada por el
  cliente" / "Sticker enviado por el cliente"; `<audio controls>` y `<video controls>` con
  `aria-label` descriptivo; la descarga es un `<a download>` con el nombre visible como texto del
  enlace (no solo un icono).
- **Copiar (R31):** `navigator.clipboard.writeText`; la confirmación es un
  `<span role="status">Copiado</span>` (región viva, la lee el lector de pantalla) **más** el
  cambio de icono. No hay animación de la que dependa el feedback: en la máquina del equipo
  `prefers-reduced-motion: reduce` está activo y una confirmación animada sería invisible.
- **Reacciones (R30):** se renderizan dentro del mismo `<li>` de la burbuja objetivo, como chips
  solapados al borde inferior (`-mb-1` + `z-10`), con `aria-label` "Reaccionó con <emoji>".

### 7.1 Linkificación segura (R33/R34)

Helper **puro** `lib/utils/linkificar.ts`:

```ts
type SegmentoTexto = { tipo: "texto"; valor: string } | { tipo: "enlace"; valor: string; href: string };
export function linkificar(texto: string): SegmentoTexto[];
```

- Regex acotada a `https?://` seguido de caracteres no-espacio, con recorte de puntuación final
  (`.,;:!?)` y `]`), para que "mira https://x.co/a." no se lleve el punto dentro del enlace.
- El `href` se valida con `new URL()` y se **rechaza** si el protocolo no es `http:`/`https:`
  (R34): `javascript:`, `data:` y `file:` nunca producen un segmento `enlace`.
- `TextoConEnlaces` mapea los segmentos a nodos React: `<a target="_blank" rel="noopener
  noreferrer">` para los enlaces, texto plano para el resto. **Nunca
  `dangerouslySetInnerHTML`**: el contenido lo escribe un tercero (el cliente) y React escapa por
  construcción si se pasa como hijo.

---

## 8. Seguridad y PII (R35)

- Ni el normalizador, ni el service, ni el cliente de media, ni el route handler loguean número,
  cuerpo, caption, contacto, coordenadas ni token. Los logs citan **conteos** y **códigos**
  (patrón `procesarFallo`: `codigo=`, `transitorio=`, nunca destino).
- El token vive solo en `loadWhatsappConfig()` y solo se usa como cabecera saliente hacia
  `graph.facebook.com`. **No aparece en ninguna URL** (el `url` temporal que devuelve Meta se
  consume en el servidor y no se reenvía al navegador: reenviarlo sería exponer un enlace
  autenticado por token a la media del cliente).
- La respuesta del proxy lleva `Cache-Control: private` y `nosniff`; nunca `public`.
- `contactos_json` es PII en reposo: vive en `chat_mensaje`, que ya tiene RLS habilitada sin
  policies (solo service role), igual que el resto del hilo. No hace falta RLS nueva porque no hay
  tabla nueva.

---

## 9. Alternativas descartadas

1. **Guardar los binarios en Supabase Storage** (bucket privado + URL firmada + cron de purga).
   **Descartada por decisión humana cerrada (D1)** y además por coste: implica bucket, política
   de acceso, job de purga, PII binaria en reposo bajo nuestra custodia y una copia por mensaje.
   El proxy bajo demanda no guarda nada; su precio es que a los 30 días el archivo desaparece, y
   eso se cubre explícitamente con R24 en vez de con almacenamiento.
2. **Una sola columna `payload JSONB` para todos los tipos nuevos.** Descartada: rompe la
   consultabilidad de `media_id` y `reaccion_a_wa_message_id` (que son criterios de búsqueda y de
   índice), y en TypeScript `strict` obliga a desempaquetar `Prisma.JsonValue` con casts en cada
   lectura, que es justo la variante escondida detrás de `any` que el arnés rechaza. Se reserva el
   JSON para el único dato que sí es anidado y de aridad variable (`contacts`), y aun ese se valida
   con zod al leer.
3. **Pintar la reacción como una burbuja más del hilo** (lo más barato de implementar: no hay
   agregado ni índice). Descartada por D4: en WhatsApp la reacción pertenece al mensaje, y una
   burbuja "👍" suelta cinco mensajes más abajo no dice a qué reaccionó el cliente.
4. **Ruta proxy con el media id de Meta en la URL** (`/api/chat/media?mediaId=...`). Descartada:
   un media id no tiene dueño en nuestro modelo, así que la autorización se volvería una
   comprobación "¿existe algún mensaje con este media id asignado a mí?" —IDOR a la espera de un
   descuido— y el id acabaría en logs de acceso y en el historial del navegador.
5. **Hacer pública la ruta de media con un token firmado en la URL** (patrón de URL firmada).
   Descartada: sirve PII del cliente, obligaría a tocar `PUBLIC_ROUTES` —lo que pone roja la
   guardia 229 y exige refirmar la lista— y sustituiría una sesión ya validada por un secreto
   compartible con solo copiar el enlace.
6. **Linkificar con `dangerouslySetInnerHTML` y un `replace` de regex** (tres líneas). Descartada:
   es XSS almacenado servido desde nuestro origen, con el remitente de WhatsApp como atacante y
   el mensajero autenticado como víctima. Se trocea el texto y se renderizan nodos.
7. **Backfill del histórico `otro`** releyendo los payloads. Descartada porque es imposible: no se
   persistió el payload crudo y los binarios de más de 30 días ya no existen en Meta (§1.5).
