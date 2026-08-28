# Feature 308 — Tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con sus hermanos del mismo
> bloque. Cada task lleva **criterio de "hecho" en forma de `assert`** (no "existe el archivo" ni
> "hay un comentario": eso se satisface reescribiendo el comentario que documenta la trampa) y
> cita los `R<n>` que cubre. Al final, el mapa R→test: un requisito sin test hace que el reviewer
> rechace (`CLAUDE.md` §4).
>
> **Antes de empezar:** la ficha no puede pasar a `in_progress` hasta que cierre una de las dos
> features fullstack en vuelo (278/288) — ver `status_note` de la 308. Y hay que aprobar el spec
> en la puerta humana (`spec_ready`).

## Bloque A — Datos y migración

- [x] **A1.** `db/schema.prisma`: añadir al enum `ChatMensajeTipo` los valores `imagen`, `audio`,
  `video`, `documento`, `sticker`, `reaccion`, `contactos`, `sistema`; añadir al modelo
  `ChatMensaje` las 9 columnas nullable de design §1.2 y el índice
  `chat_mensaje_reaccion_idx` (declarado con `map:` explícito). Cubre R13.
  *Hecho:* `pnpm db:generate` compila y un test de tipos (`expectTypeOf`/asignación) acepta los
  ocho literales nuevos como `ChatMensajeTipo`.
- [x] **A2.** Migración `db/migrations/<ts>_chat_mensaje_media_reacciones/migration.sql` (UP):
  8 × `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, 9 × `ADD COLUMN`, índice parcial, con el GOTCHA
  55P04 documentado (design §1.4). Depende de A1. Cubre R13.
  *Hecho:* `tests/integration/db/chat-mensaje-media-migration.test.ts` asserta contra
  `information_schema.columns` que las 9 columnas existen y son nullable, y contra `pg_enum` que
  los 8 valores están en `chat_mensaje_tipo`.
- [x] **A3.** `down.sql` de A2: `DROP INDEX` + 9 × `DROP COLUMN IF EXISTS` + recreación del enum
  con los 4 valores previos, con la precondición documentada. Depende de A2. Cubre R13.
  *Hecho:* el mismo test asserta que tras aplicar `down.sql` en una base sin filas de los tipos
  nuevos, `pg_enum` vuelve a tener exactamente 4 valores y las 9 columnas ya no existen.

## Bloque B — Borde tipado del webhook

- [x] **B1.** `lib/types/chat-contactos.ts`: `chatContactosSchema` (zod) + tipo
  `ChatContactoNormalizado` (nombre, teléfonos, correos, direcciones, organización, URLs), todo
  opcional y tolerante (design §1.3). `[P]` con B2. Cubre R7.
  *Hecho:* `tests/unit/types/chat-contactos.test.ts` asserta que un payload de Meta real se
  normaliza con sus teléfonos/correos y que un payload corrupto devuelve `success: false` sin
  lanzar.
- [x] **B2.** `lib/types/whatsapp-webhook.ts`: extender `metaMessageSchema` con
  `image/audio/video/document/sticker/reaction/contacts/system` (todos
  `.optional().catch(undefined)`), convertir `tipoDeMeta` en el `Record` de design §2.2 y añadir
  los helpers puros `normalizarMedia`, `normalizarReaccion`, `normalizarSistema`,
  `normalizarContactos`; extender `WebhookMensajeEntrante` con `media?/reaccion?/contactos?/sistema?`.
  Depende de A1 (enum) y B1. Cubre R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11.
  *Hecho:* tests B2.T verdes en `tests/unit/types/whatsapp-webhook.test.ts` (lista abajo).

## Bloque C — Repositorio e interfaces

- [x] **C1. [P]** `lib/interfaces/repositories/IChatMensajeRepository.ts`: extender
  `ChatMensajeDTO` e `InsertarEntranteInput` con los 9 campos (contactos tipado, nunca `Json`).
  `lib/interfaces/repositories/IChatConversacionRepository.ts`: añadir
  `migrarTelefono(anterior, nuevo): Promise<number>`. Depende de A1. Cubre R13, R16 (contrato).
  *Hecho:* `pnpm typecheck` en verde con las implementaciones aún sin ampliar sería imposible ⇒
  el criterio es que typecheck pase tras C2.
- [x] **C2.** `ChatMensajeRepository`: columnas nuevas en `SELECT`/`Row`/`toDTO` y en el `data`
  de `insertarEntranteIdempotente`; `contactos_json` se valida con `safeParse` al leer (design
  §1.3). Depende de C1. Cubre R1, R7, R12, R14 (lectura tolerante).
  *Hecho:* `tests/unit/repositories/chat-mensaje-repository.test.ts` asserta que un entrante de
  imagen persiste `media_id`/`media_mime`, que un `contactos_json` corrupto devuelve
  `contactos: null` sin lanzar, y que el dedupe por `wa_message_id` sigue omitiendo el reenvío
  con las columnas nuevas.
- [x] **C3.** `ChatConversacionRepository.migrarTelefono` (UPDATE por `telefono_e164`, tolerante
  al conflicto de `@@unique([ordenId, telefonoE164])`, devuelve filas migradas). Depende de C1.
  Cubre R16, R18.
  *Hecho:* `tests/unit/repositories/chat-conversacion-repository.test.ts` asserta que reescribe
  el número del hilo y devuelve 1; y que ante un hilo ya existente con el número nuevo devuelve 0
  sin lanzar.

## Bloque D — Service (ingesta y cambio de número)

- [x] **D1.** `ChatWhatsappService.ingerirEventos`: propagar `media/reaccion/contactos/sistema` al
  `insertarEntranteIdempotente` sin tocar dedupe ni `marcarUltimoEntrante`. Depende de B2, C2.
  Cubre R1, R2, R4, R5, R7, R12.
  *Hecho:* `tests/unit/services/chat-whatsapp-service.test.ts` asserta que un entrante de imagen
  llega al repo con `mediaId`, que una reacción llega con objetivo y emoji (`null` si retirada),
  que un `wa_message_id` repetido no inserta y que solo el insert nuevo sella
  `ultimo_entrante_at`.
- [x] **D2.** Cambio de número en `ingerirEventos` (design §3): llamar `migrarTelefono` antes de
  resolver la orden, registrar el entrante `sistema` con los dos teléfonos y sumar
  `hilosMigrados` al `IngestaResumen`. Depende de D1, C3. Cubre R16, R17, R18.
  *Hecho:* mismo archivo — asserta que se llama `migrarTelefono(anterior, nuevo)`, que el mensaje
  `sistema` se inserta con ambos teléfonos, que el service **no** tiene ni usa ningún repo de
  orden/cliente (spy sobre las deps: cero escrituras fuera de los repos de chat, R17), y que
  reprocesar el mismo `wa_message_id` no inserta una segunda evidencia.
  Además, un `assert` fija la **LIMITACIÓN CONOCIDA** de R16 (decisión del humano del
  2026-08-27): tras migrar el hilo, un entrante desde el número NUEVO **no** resuelve orden y se
  cuenta `sinResolver` —la migración es evidencia, no continuidad—.
- [x] **D3. [P]** Guardia de PII: los logs del normalizador y del service no citan número, cuerpo,
  caption ni datos de contacto. Depende de D2. Cubre R35 (parte webhook/service).
  *Hecho:* el test espía `console.warn`/el `ChatLogger` inyectado durante una ingesta con número
  y caption conocidos y asserta que **ninguna** llamada contiene esas cadenas.

## Bloque E — Contrato hacia la UI

- [x] **E1. [P]** `lib/utils/chat-reacciones.ts`: función pura `agregarReacciones(mensajes)`
  (design §6). Cubre R19, R20.
  *Hecho:* `tests/unit/utils/chat-reacciones.test.ts` asserta que las filas `reaccion`
  desaparecen de la lista, que se cuelgan del mensaje objetivo, que la última del mismo autor gana
  y que una retirada (emoji `null`) deja el objetivo sin reacciones; y que una reacción a un
  mensaje ausente del hilo se descarta sin burbuja huérfana.
- [x] **E2.** `lib/types/chat-whatsapp.ts` (`ChatMensajeVista`: `media`, `contactos`, `sistema`,
  `reacciones`) + `listarHiloChat` mapea los campos nuevos y aplica `agregarReacciones`. Depende
  de C2, E1. Cubre R19, R21 (no expone el media id), R35.
  *Hecho:* `tests/unit/actions/chat-whatsapp-actions.test.ts` asserta que un hilo con imagen +
  reacción devuelve UNA burbuja con `reacciones` no vacío, que `media` **no** contiene el media id
  de Meta (`expect(JSON.stringify(vista)).not.toContain(mediaId)`) y que el scope por mensajero
  sigue devolviendo `forbidden` para una orden ajena.

## Bloque F — Cliente de media y ruta proxy

- [x] **F1. [P]** `lib/clients/whatsapp-media.ts` con `fetchImpl` inyectable, timeout, dos saltos
  (metadata → binario) y `WhatsappMediaOutcome` (`ok | expirado | error`). Cubre R21, R24, R35.
  *Hecho:* `tests/unit/clients/whatsapp-media.test.ts` asserta: con 2xx devuelve `ok` con el
  stream y el mime; con 404 de Meta devuelve `expirado`; con `error.code 100` devuelve `expirado`;
  el token viaja en `Authorization` y **no** aparece en el `detalle` de ningún error.
- [x] **F2.** `lib/repositories/ChatMensajeRepository.findMediaParaMensajero(mensajeId, mensajeroId)`
  (una query con el join a conversación/orden). Depende de C2. Cubre R23.
  *Hecho:* test de repo que asserta `null` para un mensaje de una orden de otro mensajero y el
  registro con `mediaId` para el propio.
- [x] **F3.** `app/api/chat/media/[mensajeId]/route.ts` (GET, `runtime = "nodejs"`): sesión →
  `findMediaParaMensajero` → cliente F1 → passthrough del stream; cabeceras y códigos de design
  §5.4. Depende de F1, F2. Cubre R21, R22, R23, R24, R25, R15.
  *Hecho:* `tests/integration/api/chat-media-proxy.route.test.ts` asserta: 200 con el binario y el
  `Content-Type` correcto para el mensajero dueño; **401 sin sesión y `fetchImpl` con 0 llamadas**;
  **403 con orden ajena y `fetchImpl` con 0 llamadas**; 410 con `{error:"expirado"}` cuando el
  cliente devuelve `expirado`; `?descarga=1` responde `Content-Disposition: attachment` con el
  filename saneado; un `image/svg+xml` sale como `attachment` + `application/octet-stream` +
  `nosniff`; y que el handler no escribe en ningún almacenamiento (ningún import de Storage: se
  asserta que el módulo no expone/llama a un cliente de Supabase Storage — R15).
- [x] **F4. [P]** Saneador de `filename` y decisión inline/attachment como helpers puros en
  `lib/utils/chat-media-headers.ts`. Depende de F3 (o antes; F3 los consume). Cubre R25.
  *Hecho:* test unitario que asserta que `"a\"b\r\nc/../d.pdf"` sale sin comillas, sin CR/LF ni
  separadores; que `image/png` es inline y `application/pdf` no.
- [x] **F5.** Guardia de ruta privada: la ruta NO se añade a `PUBLIC_ROUTES` ni a
  `SELF_AUTH_ROUTES` de `middleware.ts` (design §5.2). Depende de F3. Cubre R26.
  *Hecho:* `tests/integration/api/chat-media-middleware.test.ts` (molde de
  `webhook-whatsapp-middleware.test.ts`) asserta que `GET /api/chat/media/<uuid>` **sin cookie**
  responde 307 con `location` a `/login`; y `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`
  (guardia 229) sigue verde **sin modificarse** (se ejecuta y se comprueba que el diff no lo toca).

## Bloque G — UI del hilo

- [x] **G1. [P]** `lib/utils/linkificar.ts` (helper puro, design §7.1). Cubre R33, R34.
  *Hecho:* `tests/unit/utils/linkificar.test.ts` asserta que `"mira https://x.co/a. gracias"`
  produce 3 segmentos con el enlace = `https://x.co/a` (sin el punto final); que `javascript:alert(1)`
  y `data:text/html,...` NO producen segmento `enlace`; que un texto sin URL devuelve 1 segmento.
- [x] **G2.** `TextoConEnlaces.tsx`. Depende de G1. Cubre R33, R34.
  *Hecho:* `tests/components/ChatTextoConEnlaces.test.tsx` asserta que el `<a>` tiene
  `target="_blank"` y `rel="noopener noreferrer"`, que el texto circundante NO está dentro del
  `<a>`, y que el componente no usa `dangerouslySetInnerHTML` (assert sobre el HTML renderizado
  con una carga `<img onerror=...>`: se ve como TEXTO, no como elemento).
- [x] **G3.** `hooks/useMediaChat.ts` + `MediaAdjunto.tsx`: imagen/sticker con `alt`, audio/vídeo
  con `controls` + `aria-label`, documento con nombre visible y `<a download>`; carga automática
  solo para imagen/sticker (P3). Depende de E2, F3. Cubre R27, R28, R29.
  *Hecho:* `tests/components/ChatBurbujaMedia.test.tsx` asserta: la imagen expone un `img` con
  `alt` no vacío; el audio y el vídeo exponen un control con nombre accesible
  (`getByLabelText`); el documento muestra su `filename` como texto y una acción de descarga; y
  ninguna burbuja de los tipos nuevos queda con `textContent` solo de hora (R27).
- [x] **G4.** Estado `expirado` en `useMediaChat`/`MediaAdjunto` (410 → texto explícito, design
  §7). Depende de G3. Cubre R24 (lado UI).
  *Hecho:* mismo archivo — con el `fetch` mockeado a 410 se asserta que aparece el texto de "ya no
  está disponible" **dentro de la burbuja** y que NO se renderiza un `img` roto.
- [x] **G5. [P]** `TarjetaContacto.tsx` con copiado por dato. Depende de E2. Cubre R31.
  *Hecho:* `tests/components/ChatTarjetaContacto.test.tsx` asserta que se listan nombre, teléfono
  y correo; que al pulsar "Copiar teléfono" se llama `navigator.clipboard.writeText` con ESE
  valor; y que aparece una confirmación en un nodo con `role="status"` (perceptible sin
  animación).
- [x] **G6. [P]** `Reacciones.tsx` + anclaje en la burbuja objetivo. Depende de E2. Cubre R30.
  *Hecho:* `tests/components/ChatReacciones.test.tsx` asserta que el chip de emoji está DENTRO del
  mismo `<li>` que el mensaje objetivo (`within(li).getByLabelText(/Reaccionó con/)`) y que el
  hilo NO contiene un `<li>` extra por la reacción (conteo de burbujas invariante).
- [x] **G7. [P]** `BurbujaSistema.tsx`. Depende de E2. Cubre R32.
  *Hecho:* `tests/components/ChatBurbujaSistema.test.tsx` asserta que se muestran ambos números y
  que el `<li>` NO lleva `data-direccion="entrante"|"saliente"` (es fila de sistema, distinta).
- [x] **G8.** `BurbujaContenido.tsx` (switch exhaustivo con `never` en el default) y
  `ChatConversacion.tsx` delegando en él, incluido `otro` → "Mensaje no compatible". Depende de
  G2–G7. Cubre R14, R27.
  *Hecho:* `tests/components/ChatBurbujaContenido.test.tsx` asserta que un mensaje `otro` con
  `cuerpo: null` renderiza el aviso legible (y ya no una burbuja vacía), y que cada uno de los 8
  tipos nuevos renderiza contenido no vacío (test parametrizado sobre los 8).

## Bloque H — Cierre

- [ ] **H1.** ⚠️ **NO HECHA, y no se marca:** en este entorno no hay credencial de WhatsApp ni un
  payload real de Meta capturado. Queda como verificación pendiente **en producción**, anotada en
  la ficha y en `progress/current.md`. Lo original:
   Recorrido manual con un payload real de Meta (imagen + nota de voz + reacción +
  contacto) en la base local, comprobando la burbuja y la descarga por el proxy. Depende de G8.
  *Hecho:* nota en `progress/impl_308.md` con lo observado (sin pegar PII).
- [x] **H2.** `./init.sh --rapido` en verde. **Ojo:** este diff toca `db/schema.prisma`, una
  migración y `lib/types/`, así que el modo rápido **se niega solo** (`CLAUDE.md` §5) ⇒ corre
  `./init.sh` completo. Depende de H1.
  *Hecho:* gate completo en verde, con el baseline de `dev` medido ANTES (memoria: los baselines
  caducan con cualquier PR ajeno).
- [x] **H3.** `progress/impl_308.md` con el mapa R→test completo y `feature_list.json` id 308 a
  `done`. Depende de H2.
  *Hecho:* el archivo existe y su tabla coincide con la de abajo, con los 35 requisitos cubiertos.

---

## Mapa R → test (trazabilidad)

| Requisito | Test (archivo :: nombre) | Tipo |
| --- | --- | --- |
| R1 | `tests/unit/types/whatsapp-webhook.test.ts` :: *normaliza image/audio/video/document/sticker a su tipo con media id y mime* | unit |
| R2 | `tests/unit/types/whatsapp-webhook.test.ts` :: *el caption de una imagen se conserva como cuerpo; sin caption el cuerpo es null* | unit |
| R3 | `tests/unit/types/whatsapp-webhook.test.ts` :: *un media sin id degrada a otro sin lanzar* | unit |
| R4 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction con message_id y emoji se normaliza a reaccion con su objetivo* | unit |
| R5 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction con emoji vacio se normaliza como retirada (emoji null)* | unit |
| R6 | `tests/unit/types/whatsapp-webhook.test.ts` :: *una reaction sin message_id degrada a otro sin lanzar* | unit |
| R7 | `tests/unit/types/whatsapp-webhook.test.ts` :: *contacts normaliza nombre, telefonos y correos y descarta lo no declarado* + `tests/unit/types/chat-contactos.test.ts` | unit |
| R8 | `tests/unit/types/whatsapp-webhook.test.ts` :: *contacts vacio o no parseable degrada a otro sin lanzar* | unit |
| R9 | `tests/unit/types/whatsapp-webhook.test.ts` :: *system normaliza numero anterior y nuevo en los TRES subtipos (`user_changed_number`, `customer_changed_number`, `customer_identity_changed`)* — `it.each` sobre los tres, no solo el antiguo | unit |
| R10 | `tests/unit/types/whatsapp-webhook.test.ts` :: *system sin numero nuevo no migra, degrada y no lanza* | unit |
| R11 | `tests/unit/types/whatsapp-webhook.test.ts` :: *button/interactive/order/request_welcome/ephemeral y un type desconocido caen en otro sin lanzar* | unit |
| R12 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *no duplica un entrante de media ya registrado y solo el insert nuevo sella ultimo_entrante_at* | unit |
| R13 | `tests/integration/db/chat-mensaje-media-migration.test.ts` :: *la migracion crea enum y columnas y el down.sql las revierte* | integration |
| R14 | `tests/components/ChatBurbujaContenido.test.tsx` :: *un mensaje otro con cuerpo null muestra el aviso de mensaje no compatible* + `tests/unit/repositories/chat-mensaje-repository.test.ts` :: *contactos_json corrupto se lee como null* | component + unit |
| R15 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *el proxy no persiste el binario en ningun almacenamiento* | integration |
| R16 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *el cambio de numero reescribe telefono_e164 del hilo* + *LIMITACION CONOCIDA (decision humana 2026-08-27): un entrante desde el numero NUEVO NO resuelve orden y se cuenta sinResolver* + `tests/unit/repositories/chat-conversacion-repository.test.ts` :: *migrarTelefono* | unit |
| R17 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *el cambio de numero no escribe en orden ni cliente* | unit |
| R18 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *deja evidencia con ambos numeros, no la duplica al reprocesar y no rompe si el hilo destino ya existe* | unit |
| R19 | `tests/unit/actions/chat-whatsapp-actions.test.ts` :: *listarHiloChat expone media/contactos/sistema y cuelga las reacciones del mensaje objetivo sin burbuja propia* + `tests/unit/utils/chat-reacciones.test.ts` | unit |
| R20 | `tests/unit/utils/chat-reacciones.test.ts` :: *la ultima reaccion del mismo autor gana y una retirada deja el mensaje sin reacciones* | unit |
| R21 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *devuelve el binario con su Content-Type al mensajero asignado* + `tests/unit/actions/chat-whatsapp-actions.test.ts` :: *la vista no contiene el media id de Meta* | integration + unit |
| R22 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *sin sesion responde 401 y no llama a la Graph API* | integration |
| R23 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *con una orden de otro mensajero responde 403 y no llama a la Graph API* | integration |
| R24 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *media caducada responde 410 expirado* + `tests/components/ChatBurbujaMedia.test.tsx` :: *ante 410 la burbuja dice que el archivo ya no esta disponible* + `tests/unit/clients/whatsapp-media.test.ts` | integration + component + unit |
| R25 | `tests/integration/api/chat-media-proxy.route.test.ts` :: *?descarga=1 responde attachment con filename saneado; un svg sale como octet-stream con nosniff* + `tests/unit/utils/chat-media-headers.test.ts` | integration + unit |
| R26 | `tests/integration/api/chat-media-middleware.test.ts` :: *GET /api/chat/media sin cookie redirige a /login (la ruta no es publica ni self-auth)* | integration |
| R27 | `tests/components/ChatBurbujaContenido.test.tsx` :: *cada uno de los ocho tipos nuevos renderiza contenido perceptible (ninguna burbuja vacia)* | component |
| R28 | `tests/components/ChatBurbujaMedia.test.tsx` :: *la imagen tiene alt y el audio/video exponen controles con nombre accesible* | component |
| R29 | `tests/components/ChatBurbujaMedia.test.tsx` :: *el documento muestra su nombre y ofrece descarga* | component |
| R30 | `tests/components/ChatReacciones.test.tsx` :: *el emoji se pinta dentro del li del mensaje objetivo y no anade una burbuja al hilo* | component |
| R31 | `tests/components/ChatTarjetaContacto.test.tsx` :: *cada dato del contacto se copia y la confirmacion aparece en un role=status* | component |
| R32 | `tests/components/ChatBurbujaSistema.test.tsx` :: *la burbuja de sistema cita ambos numeros y no es entrante ni saliente* | component |
| R33 | `tests/unit/utils/linkificar.test.ts` :: *solo el tramo de la URL se convierte en enlace* + `tests/components/ChatTextoConEnlaces.test.tsx` :: *el enlace lleva target blank y rel noopener noreferrer* | unit + component |
| R34 | `tests/unit/utils/linkificar.test.ts` :: *javascript:, data: y file: no producen enlace* + `tests/components/ChatTextoConEnlaces.test.tsx` :: *una carga con etiquetas HTML se renderiza como texto* | unit + component |
| R35 | `tests/unit/services/chat-whatsapp-service.test.ts` :: *la ingesta no loguea numero, cuerpo ni datos de contacto* + `tests/unit/clients/whatsapp-media.test.ts` :: *el token no aparece en ningun detalle de error* | unit |
