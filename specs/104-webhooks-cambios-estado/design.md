# Feature 99 — Design

Consume la infraestructura de cola de la feature 90 (en `dev`) y el choke point de
historial de la feature 49. Rama base: `origin/dev` limpio, worktree aislado (patrón de la
91: no checkout sobre `flow`, WIP ajeno + drift de sesiones paralelas).

Referencias verificadas en el código (no supuestas):
`lib/interfaces/repositories/IJobRepository.ts` (`enqueue(tipo, payload, opts, tx)` +
`JobTxClient`), `lib/services/JobQueueService.ts`, `app/api/cron/procesar-jobs/route.ts`
(`buildHandlers`/`buildRecurrencias`), `lib/repositories/registrar-cambio-estado.ts`
(`appendCambioEstado`, choke point), `db/schema.prisma` (`model ApiKey:1039`,
`model Orden:313` con `tienda_id`, `enum JobTipo:1060`),
`db/migrations/20260720120000_job_tipo_optimizacion_ruta/` (patrón de `ADD VALUE` solo).

> **Gate F1.4 CERRADO (aprobado 2026-07-21).** D1–D5 resueltas (ver `requirements.md`
> §"Resolución del gate F1.4"): canal = **Server Action** en la UI (D1), secreto **cifrado
> en reposo** (D2), emisión **solo para órdenes cargadas por API key** (D3), **F100** nace
> (D4), `maxIntentos = 5` (D5), más el requisito nuevo **R31** (persistir el desenlace de
> entrega). Este design ya refleja todo; no queda nada por confirmar antes de implementar.

---

## 1. Modelo de datos

### 1.1 Tabla `webhook_suscripcion`

Una fila por *owner* (el usuario dueño de las órdenes; para integradores, el usuario
dedicado de la API key). El identificador del suscriptor **no** se inventa: es
`owner_usuario_id`, y el vínculo con las órdenes ya existe (`orden.tienda_id`).

```prisma
model WebhookSuscripcion {
  id            String   @id @default(uuid())
  ownerUsuarioId String  @unique @map("owner_usuario_id") // R1: 1 por owner
  url           String   // callback https (validada en el borde, R5)
  secret        String   // secreto de firma HMAC — ver §1.3 (D2)
  activa        Boolean  @default(true) // R8: baja = activa=false
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  owner Usuario @relation("WebhookSuscripcionOwner", fields: [ownerUsuarioId], references: [id])

  @@map("webhook_suscripcion")
}
```

`owner_usuario_id` **único** codifica R1 (a lo sumo una suscripción por owner) y R6 (el
re-registro es un upsert por esa clave, no una fila nueva). RLS habilitada sin policies
(R2), patrón `api_key` / `jobs` / `geocode_cache`: guarda un secreto y no es accesible
desde el cliente.

### 1.2 Ampliación del enum `job_tipo`

```sql
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'webhook_estado';
```

**Va en su propia migración, sola.** Postgres no permite USAR un valor de enum en la misma
transacción que lo añadió (error `55P04`) y Prisma Migrate corre cada `migration.sql` en
una transacción. Precedentes exactos: `20260719120000_job_tipo_geocodificacion` (91) y
`20260720120000_job_tipo_optimizacion_ruta` (92), replicados sin variar. El `down.sql`
**no puede** usar `DROP VALUE` (no existe en Postgres): recrea el tipo, borrando antes las
filas `jobs` de ese tipo (patrón idéntico al `down.sql` de la 92):

```sql
DELETE FROM "jobs" WHERE "tipo" = 'webhook_estado';
ALTER TYPE "job_tipo" RENAME TO "job_tipo_old";
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta');
ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING ("tipo"::text::"job_tipo");
DROP TYPE "job_tipo_old";
```

### 1.3 Almacenamiento del secreto — CIFRADO EN REPOSO (D2, RESUELTA)

**Diferencia clave respecto a `ApiKey`.** `ApiKey` guarda solo el SHA-256 (R16 de la 81)
porque su única operación es *comparar* una key entrante. Aquí el emisor necesita el
secreto **legible** para *firmar* el HMAC de cada entrega: un hash no sirve.

**Decisión (D2): el secreto se cifra en reposo** (no texto plano). `webhook_suscripcion.secret`
guarda el **ciphertext** (no el secreto en claro). Mecanismo (§3.1): AES-256-GCM con una
clave simétrica de 32 bytes resuelta por entorno (`WEBHOOK_SECRET_ENC_KEY`, base64/hex). El
formato persistido empaqueta `iv` + `authTag` + `ciphertext` (p. ej.
`v1:<iv_b64>:<tag_b64>:<ct_b64>`), de modo que el descifrado verifique integridad (GCM) y
sea versionable para rotación futura de clave.

- **Al registrar (R7):** el service genera el secreto en claro (patrón api key,
  `ordx_whsec_…`), lo muestra UNA sola vez al maestro, y persiste **solo su ciphertext**.
- **Al entregar (R32):** el handler lee el ciphertext, lo descifra en memoria justo para
  firmar, y nunca lo loguea (R29).
- **Clave ausente:** la config NO lanza al cargar (R28); pero sin clave el descifrado lanza
  un error recuperable → el job de entrega **falla recuperable** (backoff) y reintenta
  cuando la clave esté puesta. El secreto (ni en claro ni cifrado) NUNCA va a logs (R32).

Sigue habiendo RLS solo-service-role sobre la tabla (R2): el cifrado es defensa en
profundidad, no la sustituye.

### 1.4 Migración

Una migración A (enum, sola) y una migración B (tabla + índice único + RLS). Timestamps
crecientes; A antes que B. Ambas con `down.sql` (`docs/architecture.md` §Migraciones).

---

## 2. Configuración — `lib/config/webhook.ts`

Clon estructural de `lib/config/cron.ts` / `lib/config/geocode.ts`: ausente/`""` →
defaults, **nunca lanza** (R28).

```ts
export interface WebhookConfig {
  WEBHOOK_TIMEOUT_MS: number;      // default 10_000
  WEBHOOK_REPLAY_WINDOW_S: number; // default 300 (anti-replay)
  WEBHOOK_SECRET_ENC_KEY: string | null; // clave AES-256-GCM (D2); ausente/"" -> null, NUNCA lanza (R28/R32)
}
export function loadWebhookConfig(): WebhookConfig { /* … */ }
```

`WEBHOOK_MAX_ATTEMPTS` **no** es config: `maxIntentos` quedó FIJADO en 5 (D5), constante del
tipo en el helper de encolado (§6), no un env.

`.env.example` gana, comentadas, en `# Integraciones (según feature)`:
`# WEBHOOK_TIMEOUT_MS=`, `# WEBHOOK_REPLAY_WINDOW_S=`, `# WEBHOOK_SECRET_ENC_KEY=`.

---

## 3. Firma — `lib/crypto/webhook-firma.ts` (D2, RESUELTA)

Función pura, sin red ni DB.

```ts
/** HMAC-SHA256 hex de `${timestampUnix}.${cuerpo}` con el secreto del owner (R18). */
export function firmarWebhook(secret: string, timestampUnix: number, cuerpo: string): string;
```

Cabeceras de la entrega: `X-Ordenex-Signature: sha256=<hex>` y `X-Ordenex-Timestamp: <unix>`.
El consumidor recomputa el HMAC y rechaza si `|now - timestamp| > WEBHOOK_REPLAY_WINDOW_S`
(anti-replay). El secreto NUNCA viaja en la petición ni en logs (R29). Se usa `crypto` de
Node (ya disponible; `hashApiKey` usa `createHash`).

### 3.1 Cifrado del secreto en reposo — `lib/crypto/webhook-secret-cipher.ts` (D2, R32)

Módulo NUEVO (el repo no tiene cifrado aplicativo hoy). Funciones puras salvo la lectura de
la clave, que se inyecta:

```ts
/** AES-256-GCM. Empaqueta `v1:<iv_b64>:<tag_b64>:<ct_b64>`. */
export function cifrarSecreto(claveRaw: string, secreto: string): string;
/** Descifra y verifica el authTag. Lanza `WebhookSecretKeyError` (recuperable) si la clave
 *  falta o es inválida, o si el authTag no cuadra. NUNCA incluye el secreto en el error. */
export function descifrarSecreto(claveRaw: string | null, empaquetado: string): string;
```

- La clave (`WEBHOOK_SECRET_ENC_KEY`, 32 bytes en base64/hex) se resuelve por
  `loadWebhookConfig()` (§2), que devuelve `null` si falta — **sin lanzar** (R28).
- `descifrarSecreto(null, …)` lanza `WebhookSecretKeyError`, un error **recuperable**: el
  handler (§7) lo deja propagar → la cola aplica backoff (R20/R32), no dead-letter inmediato,
  para que al configurar la clave los eventos pendientes se entreguen.
- IV aleatorio por cifrado (no reutilizar IV con GCM). El `v1:` versiona el esquema para
  rotación futura de clave/algoritmo sin migrar datos a ciegas.
- Round-trip testeado (R32): `descifrar(cifrar(s)) === s`; y clave ausente → error recuperable
  sin filtrar `s`.

---

## 4. Cliente de entrega — `lib/clients/webhook-sender.ts` + `IWebhookSender`

Contrato en `lib/interfaces/external/IWebhookSender.ts` (`docs/architecture.md`
§`interfaces/external/`). El cliente **traduce** el resultado HTTP a vocabulario de dominio
y **no decide** política (completar vs lanzar): eso vive en el service (§6), como hizo la 91.

```ts
export type WebhookOutcome =
  | { status: "ok" }                       // 2xx
  | { status: "transitorio"; detalle: string }; // no-2xx | timeout | red

export interface IWebhookSender {
  entregar(url: string, cuerpo: string, headers: Record<string, string>): Promise<WebhookOutcome>;
}
```

`fetch` inyectable (`fetchImpl?: typeof fetch`, patrón `carga-masiva-chunks.ts:62`) +
`AbortController` con `WEBHOOK_TIMEOUT_MS`. Permite testear todos los desenlaces sin red.
El detalle de error NUNCA incluye la URL completa ni el cuerpo (R29).

> **Nota de seguridad (SSRF).** El callback es una URL externa arbitraria bajo control del
> integrador; el POST sale del servidor. Se restringe a `https` (R5). Bloquear rangos
> privados/loopback es un endurecimiento deseable anotado como seguimiento (§11), no alcance
> de v1.

---

## 5. Repositorios

- `IWebhookSuscripcionRepository` + `WebhookSuscripcionRepository` (patrón
  `ApiKeyRepository`, `Pick<PrismaClient>`): `upsertByOwner`, `findActivaByOwner`,
  `desactivarByOwner`. Solo queries, sin lógica (`docs/architecture.md` §Repository).
- Para el **enqueue en el choke point** (§6) se necesita, dentro de la tx, saber qué
  órdenes del lote pertenecen a un owner con suscripción activa **y de rol `apiKey`** (D3:
  solo órdenes cargadas por API key). Se resuelve con UNA consulta por lote:
  ```sql
  SELECT o.id, o.tienda_id
  FROM orden o
  JOIN webhook_suscripcion w ON w.owner_usuario_id = o.tienda_id AND w.activa
  JOIN usuario u ON u.id = o.tienda_id
  JOIN rol r ON r.id = u.rol_id AND r.value = 'apiKey'
  WHERE o.id IN (...)
  ```
  El `JOIN` a `rol.value = 'apiKey'` es el **guard explícito** de D3: aunque la invariante ya
  se sostiene (un usuario `apiKey` no tiene `rol_permiso` → no crea órdenes por UI, solo por
  `cargarViaApi`), el guard la vuelve enforced y no incidental. Cuando no hay ninguna
  suscripción en el sistema (caso mayoritario), el join devuelve vacío de inmediato.

---

## 6. Emisión desde el choke point (transactional outbox) — pieza central

**Punto de enganche: `appendCambioEstado`** (`lib/repositories/registrar-cambio-estado.ts`).
Es el ÚNICO punto por el que pasan las ~13 escrituras de estado (feature 49). Emitir aquí
cubre R16 de un solo cambio y hace imposible que un call-site "olvide" emitir.

Flujo dentro de `appendCambioEstado`, en la MISMA tx (después del `createMany` del
historial):
1. Filtrar `entradas` por la **política de eventos públicos** `EVENTOS_PUBLICOS`
   (`lib/types/webhook-eventos.ts`, R15/D3). Si queda vacío → no-op. La política FIJADA:
   `en_ruta_bodega_principal`, `en_bodega`, `en_reparto`, `entregada`, `reprogramada`,
   `devuelta`, `rechazada`, `devuelta_origen`, `recibido_origen` (los estados que el
   integrador consume; se excluyen los internos de fulfillment/ruteo satélite).
2. Con los `ordenId` supervivientes, resolver en UNA consulta (§5) qué órdenes tienen owner
   con suscripción activa **y rol `apiKey`** (R12/D3). Si ninguna → no-op.
3. Por cada transición emitible, `jobRepo.enqueue("webhook_estado", payload, opts, tx)`
   usando el 4.º parámetro `tx` (transactional-outbox). Si la tx del cambio revierte, los
   jobs se van con ella (R11) — gratis, como en la 91.

**Payload del JOB (R13) — mínimo, sin PII, sin secreto:**
```jsonc
{ "ordenId": "<uuid>", "estatusDestinoId": "<uuid>", "ocurridoAt": "<ISO>" }
```
El handler resuelve al ENTREGAR los campos legibles del **cuerpo de entrega** (D3):
```jsonc
{
  "evento": "orden.estado_actualizado",
  "eventoId": "<dedupeKey>",           // R23: el consumidor deduplica por aquí
  "ocurridoAt": "<ISO>",
  "orden": { "numGuia": 12345, "numRemision": "ABC-1", "estado": "en_reparto" }
}
```
Se emiten `num_guia`, `num_remision` y el estado en texto (D3). **Datos del destinatario
(nombre/teléfono): NO se incluyen** por defecto (privacidad; pregunta abierta 2 resuelta a
"solo identificadores" salvo pedido posterior). El payload del job no envejece (no duplica
datos de la orden en la cola).

**dedupeKey (R14):** cada transición es un evento único. La clave debe distinguir dos
transiciones al MISMO estado de la MISMA orden (reintentos: `en_bodega → … → en_bodega`).
Recomendado:
```
webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt-ISO>
```
El instante desambigua repeticiones. (Alternativa: usar el `id` de la fila de historial,
pero `createMany` no lo devuelve; el instante es suficiente y determinista dentro de la tx.)

> **⚠️ Cómo NO cablearlo.** Con `dedupeKey = webhook_estado:<ordenId>:<estatusDestinoId>`
> a secas, una orden que reingresa a un estado por reintento (patrón de la feature 47)
> chocaría con la fila `done` del evento anterior y el `ON CONFLICT DO NOTHING` descartaría
> el segundo evento **en silencio** (el índice único de `dedupe_key` no está acotado por
> estado y las filas `jobs` no se purgan — mismo hallazgo que la 91, R13). El componente de
> instante es **obligatorio**, no cosmético.

**maxIntentos (R27, D5 FIJADA = 5):** override por fila en el `enqueue`
(`MAX_INTENTOS_WEBHOOK = 5`, constante del helper de encolado). Un callback de integrador que
no responde se reintenta con backoff y, tras 5 intentos, va al dead-letter visible (`failed`,
consultable — R31), sin reintentar indefinidamente.

### 6.1 Cómo se cabla sin romper la función pura

`appendCambioEstado` hoy es pura y su `tx` está tipado `OrdenHistorialTxClient =
Pick<PrismaClient,"ordenHistorialEstado">`. Para emitir necesita, dentro de la misma tx:
leer `orden`/`webhook_suscripcion` y encolar por `IJobRepository.enqueue(..., tx)`. Se
introduce un **emisor inyectable** que la función invoca tras el append:

```ts
export type WebhookEmisor = (tx: WebhookEmisorTx, entradas: CambioEstadoEntrada[]) => Promise<void>;

export async function appendCambioEstado(
  tx: OrdenHistorialTxClient & WebhookEmisorTx,
  entradas: CambioEstadoEntrada[],
  emitir?: WebhookEmisor,   // opcional: default = emisor real; los tests inyectan un espía
): Promise<void>;
```

- Mantiene un solo choke point y una sola edición.
- El `tx` real de los call-sites es el Prisma tx completo, que satisface tanto
  `OrdenHistorialTxClient` como `WebhookEmisorTx` (`$queryRaw`/`$executeRaw` para el enqueue
  y la consulta de §5). Se widen el tipo, no la semántica.
- `emitir` opcional con default preserva la firma para los 13 call-sites (no se tocan) y
  permite espiar en tests.

---

## 7. Handler — `lib/services/jobs/webhook-estado-handler.ts` (+ service)

Implementa `JobHandler = (job: JobDTO) => Promise<void>`
(`IJobQueueService.ts:7`). DI por interfaces: `IOrdenRepository` (o un repo de lectura
mínimo), `IWebhookSuscripcionRepository`, `IWebhookSender`, `WebhookConfig`, `now`, `logger`.

Flujo:
1. Valida el payload con zod → `{ ordenId, estatusDestinoId, ocurridoAt }`. Forma inválida
   → **lanza** (R30).
2. Lee la orden. No existe o `deletedAt != null` → **retorna** (job completo, R22).
3. Resuelve `findActivaByOwner(orden.tiendaId)`. Sin suscripción activa → **retorna**
   (R21). **Aislamiento (R24/R25):** el destino se deriva SIEMPRE de `orden.tiendaId`;
   nunca de un dato del payload.
4. **Descifra el secreto** (`descifrarSecreto(config.WEBHOOK_SECRET_ENC_KEY, sub.secret)`,
   §3.1). Si la clave falta o el authTag no cuadra → `WebhookSecretKeyError` **recuperable**
   → **lanza** → backoff (R32); el secreto NUNCA se loguea.
5. Construye el cuerpo determinista de entrega (D3: `num_guia`, `num_remision`, estado en
   texto, instante), calcula un `eventoId` estable (= la `dedupeKey`) para deduplicación del
   consumidor (R23), firma con `firmarWebhook` (§3) y arma cabeceras.
6. `sender.entregar(...)`:
   - `ok` (2xx) → retorna → `complete` (R19).
   - `transitorio` (no-2xx | timeout | red) → **lanza un `Error` cuyo mensaje lleva el
     `detalle`** del outcome → la cola aplica backoff/reintento y persiste el motivo en
     `jobs.last_error` (R20/R27/**R31**); tras 5 intentos → dead-letter visible.

**Persistencia del desenlace (R31, ver §12):** el handler NO escribe estado de entrega por
su cuenta; se apoya en `JobQueueService.fail`, que ya escribe `estado`/`intentos`/
`last_error`/`updated_at` en la fila `jobs`. La única exigencia es que el `detalle` del
outcome transitorio viaje en el `Error` que el handler lanza, para que aterrice en
`last_error` sin secreto ni PII.

**Idempotencia (R23):** el paso 5 es determinista por `(ordenId, estatusDestinoId,
ocurridoAt)`; reejecutar produce el mismo `eventoId` y cuerpo. El consumidor deduplica por
`eventoId`. Reentregar tras un reintento no corrompe: es el mismo evento.

**Logs (R29):** logger inyectable, solo mensajes agregados
(`"[webhook_estado] entrega fallida (transitorio)"`). Nunca secreto, URL ni destinatario.

---

## 8. Wiring del cron

En `app/api/cron/procesar-jobs/route.ts`, dentro de `buildHandlers()`:

```ts
handlers.set("webhook_estado", crearWebhookEstadoHandler(buildWebhookEstadoService(now)));
```

`buildRecurrencias()` **no se toca**: el webhook se encola por EVENTO, no es recurrente
(R26). `vercel.json` **no se toca**: el drenado ya corre cada minuto. Un fallo suyo (p. ej.
callback caído) lo captura `JobQueueService.drenar` job a job, sin afectar a
`liberar_reprogramadas` / `geocodificacion` / `optimizacion_ruta`, que comparten el cron.

Es la única línea bajo `app/`, y es backend (registro de handler en un route de cron),
consistente con `zone: "backend"`.

---

## 9. Bloque B — registro de la suscripción (D1 = Server Action en la UI, RESUELTA)

El **servicio** `WebhookSuscripcionService` (validación de URL R5, generación del secreto y
cifrado antes de persistir R7/R32, upsert R6, baja R8, autorización por owner R9) es puro y
testeable sin controller.

**Controller (D1): Server Action** `lib/actions/webhooks.ts` (`'use server'`), autorizada al
rol **`maestro`** (patrón de la feature 82, que resuelve el actor server-side y hace
`notFound()`/forbidden si el rol no es maestro). **NO** es un endpoint por API key. El
maestro registra la suscripción para un owner de API key (selecciona la API key / usuario
dedicado en la pantalla F100). La acción:
1. Autoriza a `maestro`.
2. Valida la URL (R5) y que el owner objetivo es un usuario de rol `apiKey` (coherente con
   D3).
3. Genera el secreto (`ordx_whsec_…`), lo cifra (§3.1) y hace `upsertByOwner`.
4. Devuelve el secreto en claro UNA vez (R7) para que F100 lo muestre.

**F100 (D4, feature frontend hermana, ya registrada):** pantalla en `Configuración > API`
que consume esta Server Action (registrar/mostrar-una-vez/dar de baja). Fuera del alcance de
la 99 (backend). El andamiaje del submenú `Configuración > API` ya existe (features 82).

`app/api/webhooks/suscripcion/route.ts` (endpoint por API key) queda **descartado** por D1;
ver §10.6.

---

## 10. Alternativas descartadas

### 10.1 Guardar la URL/secreto en columnas de `ApiKey` — DESCARTADA

Es lo más directo (la key ya es 1:1 con su usuario dedicado), pero acopla la configuración
de *notificación* al *credencial de autenticación*: (1) fuerza churn de esquema en
`api_key` por cada feature de webhooks; (2) mezcla dos ciclos de vida —rotar/expirar una key
(follow-up de la 81) arrastraría la config de webhook—; (3) no todo owner con webhook es
necesariamente un usuario de API key (un `adminTienda` real podría querer webhooks en el
futuro), y atarlo a `api_key` lo impediría. Una tabla dedicada `webhook_suscripcion` keyed
por `owner_usuario_id` separa responsabilidades, permite crecer a N endpoints por owner sin
tocar `api_key`, y aísla el secreto con su propia RLS. **Se elige la tabla dedicada.**

### 10.2 Enqueue incondicional + filtrar en el handler — DESCARTADA

Encolar un job `webhook_estado` para TODA transición de TODA orden y decidir en el handler
si el owner tiene suscripción. Es más simple en el choke point (sin la consulta de §5),
pero **inunda la cola**: la inmensa mayoría de las órdenes las crea/gestiona el
`adminTienda` por UI, sin webhook; se generarían millones de jobs no-op que se completan sin
hacer nada, hinchando `jobs` (que además no se purga, §11) y el drenado. El filtro en el
enqueue (R12) cuesta UNA consulta indexada por lote —vacía cuando no hay suscripciones—.
**Se elige filtrar en el enqueue.**

### 10.3 Emitir en cada call-site en vez del choke point — DESCARTADA

Poner el `enqueue` en cada uno de los ~13 sitios que escriben estado. Frágil: hay que no
olvidar ninguno y mantenerlo al añadir sitios nuevos, exactamente el problema que la feature
49 resolvió centralizando en `appendCambioEstado`. **Se emite en el choke point** (§6).

### 10.4 Entrega síncrona en la tx del cambio de estado — DESCARTADA

Hacer el POST al callback dentro de la transacción que cambia el estado acoplaría la
latencia y disponibilidad de un tercero al camino crítico de gestión de órdenes: un callback
lento bloquearía cerrar una gestión, y uno caído la haría fallar. La cola (feature 90) existe
precisamente para desacoplar esto. **Se entrega asíncrono vía job.**

### 10.5 Enum nativo para el "estado" en el payload/tabla — N/A

No se persiste vocabulario de estado nuevo: se reusa `order-status.ts` y los FK existentes.

### 10.6 Endpoint de registro autenticado por API key — DESCARTADA (D1)

La otra opción de D1: que el integrador se auto-registre presentando su key en un Route
Handler. Se descarta porque el humano eligió la UI: el maestro controla qué integradores
tienen webhook desde `Configuración > API`, sin exponer una superficie de escritura pública
autenticada por key (la 88 dejó la key solo para carga de órdenes). Reconsiderable si se
pide self-service de integradores.

### 10.7 Secreto en texto plano protegido solo por RLS — DESCARTADA (D2)

Era el recomendado inicial del spec_author (simple, sin gestión de clave). El humano exigió
**cifrado en reposo** (§1.3): el secreto no vive en claro en la DB ni en un dump. Cuesta un
módulo de cifrado y una clave en entorno; a cambio, un acceso de solo-lectura a la tabla no
basta para forjar firmas. **Se cifra (§3.1).**

### 10.8 Tabla de entregas por-orden para el desenlace (R31) — DESCARTADA

Modelar cada intento de entrega en una tabla consultable por orden. Es el "panel de
entregas", follow-up declarado fuera de alcance. Para R31 basta la fila `jobs` (§12): ya
persiste `estado`, `intentos`, `last_error`, `updated_at`. **Se usa `jobs`.**

---

## 11. Seguimientos anotados (no son alcance de esta feature)

1. **Purga de `jobs`.** Las filas `done` de `webhook_estado` crecen sin límite (la 90 no
   definió retención); con la `dedupeKey` por instante esto es correcto pero no gratuito.
2. **Endurecimiento SSRF** del sender (bloquear loopback/rangos privados) — §4.
3. **Reintentos configurables por cliente** y **panel de entregas** (tabla de entregas
   por-orden, §10.8) — fuera de alcance (follow-up declarado en la descripción de la feature).
4. **N endpoints por owner** — la tabla lo permite ampliar (quitar el `@unique` y añadir
   grano), si el humano lo pide (pregunta abierta 1).
5. **Rotación de `WEBHOOK_SECRET_ENC_KEY`** — el prefijo `v1:` del ciphertext (§3.1) deja la
   puerta abierta a re-cifrar con una clave nueva sin migración a ciegas.

---

## 12. Persistencia del desenlace de entrega (R31) — mínimo suficiente

Pedido del humano: "guardar si es error y cuál fue el error". Se resuelve **sin tabla
nueva**, apoyándose en la fila `jobs` que la cola (feature 90) ya mantiene:

| Dato | Dónde queda | Escrito por |
| --- | --- | --- |
| ¿hubo error? | `jobs.estado` (`pending` re-agendado / `failed` dead-letter) | `JobQueueService.fail` |
| motivo del error | `jobs.last_error` | `JobQueueService.fail` |
| nº de intentos | `jobs.intentos` | `JobRepository.claimBatch` |
| instante | `jobs.updated_at` | Prisma `@updatedAt` |

**Única exigencia sobre esta feature (R31):** el handler (§7, paso 6) DEBE lanzar un `Error`
cuyo mensaje lleve el `detalle` del `WebhookOutcome` transitorio (código HTTP, "timeout",
"red"), para que `JobQueueService.fail` lo escriba en `last_error`. El mensaje NUNCA incluye
el secreto, la URL con credenciales ni PII (R29). Consultar el desenlace = leer la fila
`jobs` por su `dedupeKey` (`webhook_estado:<ordenId>:…`), que es determinista desde la orden.
