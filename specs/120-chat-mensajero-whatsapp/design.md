# Feature 109 — Diseño técnico

> Decisiones técnicas para `requirements.md`. Respeta `docs/architecture.md`
> (Controller → Service → Repository, borde tipado con zod, idempotencia en webhooks, RLS,
> migraciones up/down) y `docs/conventions.md` (kebab-case, snake_case en DB, sin logs de
> secretos/PII). Reutiliza la infraestructura WhatsApp existente; NO la reinventa.

## 0. Infraestructura reutilizada (no se toca su contrato)

- `lib/clients/whatsapp-cloud.ts` — `WhatsappCloudClient.enviarTexto(destino, texto)` y
  `.enviarPlantilla(destino, nombre, idioma, componentes)`. Devuelven
  `{status:"ok", mensajeId}` o `{status:"transitorio", detalle}`. Invariante: nunca loguear
  token ni número destino.
- `lib/config/whatsapp.ts` — `loadWhatsappConfig()` (token, numeroId, wabaId, apiVersion,
  templateIdioma) y `WhatsappNoConfiguradoError(pieza)` que cita el nombre de la variable.
- Feature 107 — `plantilla_mensaje` (+ `template_id`, `template_idioma`), `OrdenEnvioReader`
  (scope por `mensajeroAsignadoId`), `EnvioPlantillaWhatsappService`, Server Actions en
  `lib/actions/whatsapp-envio.ts`, botón `EnviarPlantillaWhatsappButton.tsx`.
- Cola de jobs — `app/api/cron/procesar-jobs/route.ts`, enum `JobTipo`, `lib/services/jobs/*`.
- `middleware.ts` — listas `PUBLIC_ROUTES` / `SELF_AUTH_ROUTES`.

## 1. Modelo de datos (Prisma + migración con down.sql + RLS)

Nueva migración `db/migrations/<timestamp>_chat_whatsapp/` con `migration.sql` (UP) y
`down.sql` (DOWN obligatorio, patrón `20260722130000_plantilla_mensaje`). Dos enums nativos
y dos tablas. RLS habilitada SIN policies (solo service role), patrón `plantilla_mensaje` /
`gestion_orden`: la autorización de negocio vive en el service (R16), no en la DB.

### 1.1 Enums nativos

```
enum ChatMensajeDireccion { entrante  saliente  @@map("chat_mensaje_direccion") }
enum ChatMensajeTipo      { texto  plantilla  otro  @@map("chat_mensaje_tipo") }
enum ChatMensajeEstado    { queued  sent  delivered  read  failed  @@map("chat_mensaje_estado") }
```

`ChatMensajeEstado` solo aplica a salientes (nullable en entrantes).

### 1.2 Tabla `chat_conversacion` (hilo) — R13

| columna | tipo | notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `telefono_e164` | text NOT NULL | número del cliente normalizado E.164 (sin `+`, formato del cliente de envío) |
| `orden_id` | text NOT NULL FK → `orden` | ON DELETE RESTRICT (no huérfanos) |
| `mensajero_id` | text NOT NULL FK → `usuario` | mensajero asignado del hilo; ON DELETE RESTRICT |
| `ultimo_entrante_at` | timestamptz NULL | marca del último mensaje ENTRANTE; fuente de la ventana de 24 h (R18/R19) |
| `created_at` / `updated_at` | timestamptz | patrón repo |

Índices: `@@unique([ordenId, telefonoE164])` (un hilo por orden+número; ver D4),
`@@index([mensajeroId])` (scope R16), `@@index([telefonoE164])` (resolución entrante R25).

### 1.3 Tabla `chat_mensaje` — R14

| columna | tipo | notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `conversacion_id` | text NOT NULL FK → `chat_conversacion` | ON DELETE CASCADE |
| `direccion` | `chat_mensaje_direccion` NOT NULL | enum |
| `tipo` | `chat_mensaje_tipo` NOT NULL | |
| `cuerpo` | text NULL | texto plano; NULL para tipos sin cuerpo |
| `plantilla_id` | text NULL FK → `plantilla_mensaje` | solo salientes de tipo plantilla; ON DELETE SET NULL |
| `wa_message_id` | text NULL | id de Meta; **único** para dedupe (R8) |
| `estado` | `chat_mensaje_estado` NULL | solo salientes (R7) |
| `ocurrido_at` | timestamptz NOT NULL | timestamp del evento (de Meta en entrantes) |
| `created_at` | timestamptz | inmutable, sin updatedAt/deletedAt salvo `estado` |

Índices: `@@unique([waMessageId])` parcial `WHERE wa_message_id IS NOT NULL` (dedupe R8;
Prisma no expresa índice parcial → va a mano en la migración, patrón `wallet_movimiento`),
`@@index([conversacionId, ocurridoAt])` (historial ordenado R22).

> Nota: el `@@unique` parcial sobre `wa_message_id` cubre dedupe de entrantes (R8) y la
> localización del saliente al llegar un `status` (R7).

## 2. Rutas / endpoints

### 2.1 `app/api/webhooks/whatsapp/route.ts` (Route Handler, Controller)

- **GET** (R1/R2): lee `hub.mode`, `hub.verify_token`, `hub.challenge`. Compara el token con
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Si `mode==="subscribe"` y token coincide → `200` con
  `hub.challenge` como `text/plain`. Si no → `403`. Sin tocar DB.
- **POST** (R3–R9): lee el **cuerpo crudo** (`await req.text()`) ANTES de parsear JSON;
  calcula `HMAC-SHA256(raw, WHATSAPP_APP_SECRET)` y lo compara en tiempo constante con
  `X-Hub-Signature-256` (formato `sha256=<hex>`). Firma inválida/ausente → `401` sin
  efectos (R4). Firma válida → `JSON.parse` + zod strip (R5) → delega en el service →
  responde `200` (R9). Nunca loguea secretos ni PII (R11).
- Auth del endpoint = la firma; se añade `/api/webhooks` a `SELF_AUTH_ROUTES` de
  `middleware.ts` (R10). Documentar el matcher en el propio `middleware.ts`.

### 2.2 Server Actions `lib/actions/chat-whatsapp.ts` (`'use server'`)

- `enviarMensajeChat(ordenId, texto)` (R17–R21): resuelve actor por sesión
  (`resolveActorFromSession`), valida propiedad vía `OrdenEnvioReader` (scope
  `mensajeroAsignadoId`), aplica la ventana de 24 h leyendo `ultimo_entrante_at`, llama al
  service y persiste. Fuera de ventana → rechaza pidiendo plantilla (reusa
  `enviarPlantillaWhatsapp` de la 107).
- `listarHiloChat(ordenId)` (R16/R22/R24): devuelve el historial del hilo de una orden del
  mensajero. Consumida por la UI para el refresco (ver D5).

## 3. Capas (Controller → Service → Repository)

- **Controller:** el route handler (webhook) y las Server Actions. Solo HTTP/sesión + firma.
- **Service:** `ChatWhatsappService` (`lib/services/ChatWhatsappService.ts`). Lógica pura,
  testeable sin DB ni HTTP: dedupe, resolución de hilo desde número entrante (D4), regla de
  ventana de 24 h, orquestación del envío. Recibe repos + `WhatsappCloudClient` por
  constructor (inyección por interfaz, patrón `EnvioPlantillaWhatsappService`).
- **Repository:** `ChatConversacionRepository` + `ChatMensajeRepository`
  (`lib/repositories/`), solo Prisma. Interfaces en `lib/interfaces/repositories/`.
- **Borde tipado:** esquema zod del payload de Meta en `lib/types/whatsapp-webhook.ts`
  (strip). El service NO conoce la forma de Meta: recibe un tipo de dominio ya normalizado.

## 4. Config y variables de entorno

`loadWhatsappWebhookConfig()` en `lib/config/whatsapp.ts` (o módulo hermano) que lee
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` y `WHATSAPP_APP_SECRET` con el mismo `readRequired` que cita
el nombre y nunca el valor (R12), lanzando `WhatsappNoConfiguradoError`. Documentar ambas en
`.env.example` (pendiente de confirmación en D6).

## 5. UI (rol mensajero, dentro de `mis-asignaciones`)

Componente co-ubicado `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx`
(no se promueve a `shared/`: un solo consumidor, regla anti-sobre-ingeniería de
`architecture.md`). Colgado de `GestionarOrdenPanel`. Historial ordenado con burbujas
entrante/saliente y badge de estado de entrega (R22). Input de texto habilitado/deshabilitado
según ventana de 24 h; fuera de ventana muestra `EnviarPlantillaWhatsappButton` (107) (R23).
Refresco según D5. Primero revisar primitivas shadcn/ui antes de crear componente propio.

## 6. Seguridad e idempotencia

- Firma HMAC comparada en tiempo constante (`crypto.timingSafeEqual`) sobre el cuerpo crudo
  (R3/R4). Nunca parsear antes de verificar.
- Dedupe por `wa_message_id` único (R8); un `INSERT ... ON CONFLICT DO NOTHING` o un check
  previo en el repo, dentro de una transacción por evento.
- Sin `console.log` de token/secreto/número (R11), patrón invariante del cliente existente.

## 7. Alternativa descartada

**Descartada: reutilizar `app/api/cron/procesar-jobs` como único punto de entrada del
webhook, drenando los eventos entrantes como jobs desde el mismo cron.** Se evaluó registrar
la ingestión entrante como un `JobTipo` nuevo y que el webhook solo encolara.

Motivos del descarte:
1. **Meta exige el handshake GET y una respuesta 2xx rápida** al POST; el cron corre cada
   minuto y no puede responder al request HTTP de Meta en tiempo real. El webhook DEBE ser
   un endpoint propio que responde de inmediato (R1/R9).
2. **La firma HMAC se valida sobre el cuerpo crudo del request de Meta**; ese cuerpo no
   existe en el contexto del cron. Mover la validación al drenado rompería R3/R4.
3. La separación webhook (ingestión + persistencia inmediata) vs job (solo si el ENVÍO
   saliente se encola, ver D1) es más limpia y respeta la tabla de `architecture.md`
   ("Webhook externo → Route Handler"; "Cron interno → Route Handler" son casos distintos).

Se conserva la cola de jobs **solo** como opción para el reintento del ENVÍO saliente
`transitorio` (D1), no para la ingestión entrante.

---

## Decisiones abiertas para la puerta humana (F1.4)

> El humano las resuelve; NO se inventan como cerradas. Cada una lleva recomendación.

- **D1 — Envío saliente en línea vs encolado en jobs.** Meta puede tardar o devolver
  `transitorio`. *Recomendación:* enviar **en línea** en la Server Action para v1 (feedback
  inmediato al mensajero) y, ante `transitorio`, encolar un job de reintento
  `whatsapp_chat_envio` reusando la cola existente (persistir el mensaje como `queued` y
  reconciliar el `wa_message_id` al drenar). Afecta R20/R21.

- **D2 — Alcance de la ventana de 24 h fuera de plazo.** *Recomendación:* **bloquear** el
  texto libre en el server (no solo deshabilitar en UI) y exigir plantilla; el cliente de
  Meta rechazaría el texto igualmente fuera de la ventana, así que bloquear evita un
  `transitorio` inútil. Afecta R19/R23.

- **D3 — Roles que además del mensajero asignado pueden LEER el hilo.** *Recomendación:*
  v1 solo el **mensajero asignado** (scope estricto R16); dar lectura a maestro/admin como
  follow-up. Afecta R16 y P2.

- **D4 — Resolución de la orden desde el número entrante.** Un número puede tener varias
  órdenes activas. *Recomendación:* adjuntar el entrante al hilo de la **orden activa
  asignada más reciente** de ese número (por `asignado_at` desc); si no hay ninguna,
  registrar el mensaje "sin orden" (conversación con `orden_id` = la última cerrada o
  descartar con log no-PII) para no romper el `200`. Requiere confirmación porque define el
  `@@unique([ordenId, telefonoE164])` y la semántica de R25.

- **D5 — Refresco de la UI.** *Recomendación:* **SWR con `refreshInterval`** (polling ~10 s)
  sobre `listarHiloChat`, por simplicidad y por evitar acoplar Supabase Realtime; realtime
  como follow-up. Afecta R24/P5.

- **D6 — Nombres de env y `.env.example`.** *Recomendación:* `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  y `WHATSAPP_APP_SECRET` (coherentes con `WHATSAPP_*` existentes), documentadas en
  `.env.example` sin valores. Afecta R12/R20.
</content>
