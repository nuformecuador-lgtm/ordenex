# impl_99 — Webhooks de cambios de estado para integradores con API key

Rama: `feature/99-webhooks-cambios-estado` (desde `origin/dev`). Backend puro (la UI es F100).

## Archivos creados

**Migraciones**
- `db/migrations/20260721120000_job_tipo_webhook_estado/{migration,down}.sql` — enum `job_tipo` += `webhook_estado` (sola, por el 55P04). `down.sql` recrea el tipo sin el valor (Postgres no tiene DROP VALUE), borrando antes las filas `jobs` de ese tipo.
- `db/migrations/20260721130000_webhook_suscripcion/{migration,down}.sql` — tabla `webhook_suscripcion` (owner_usuario_id único, url, secret cifrado, activa, timestamps, FK a usuario, RLS habilitada sin policies). `down.sql`: DROP TABLE.

**Config / crypto / utils / types**
- `lib/config/webhook.ts` — `loadWebhookConfig()`; ausente/"" → defaults, `WEBHOOK_SECRET_ENC_KEY` → null, nunca lanza.
- `lib/crypto/webhook-firma.ts` — `firmarWebhook` HMAC-SHA256 sobre `${ts}.${cuerpo}` + `cabecerasFirma`.
- `lib/crypto/webhook-secret-cipher.ts` — AES-256-GCM `cifrarSecreto`/`descifrarSecreto`, formato `v1:<iv>:<tag>:<ct>`, `WebhookSecretKeyError` recuperable.
- `lib/utils/webhook-secret-generator.ts` — `generarWebhookSecret` (`ordx_whsec_` + 256 bits).
- `lib/types/webhook-eventos.ts` — `EVENTOS_PUBLICOS` (política D3) + `esEventoPublico`.
- `lib/types/webhook.ts` — schemas zod + tipos de resultado de la Server Action.

**Cliente de entrega**
- `lib/interfaces/external/IWebhookSender.ts` + `lib/clients/webhook-sender.ts` — POST con `fetch` inyectable + `AbortSignal.timeout`; traduce HTTP a `WebhookOutcome` (ok | transitorio), sin URL/cuerpo en el detalle.

**Repositorios**
- `lib/interfaces/repositories/IWebhookSuscripcionRepository.ts` + `lib/repositories/WebhookSuscripcionRepository.ts` — upsertByOwner, findActivaByOwner (ciphertext), findByOwner (sin secreto), desactivarByOwner, ownerEsApiKey.
- `lib/interfaces/repositories/IWebhookOrdenReader.ts` + `lib/repositories/WebhookOrdenReader.ts` — findDatosEntrega (orden + value del destino).

**Servicios / handler / emisión**
- `lib/interfaces/services/IWebhookSuscripcionService.ts` + `lib/services/WebhookSuscripcionService.ts` — registro: valida URL https (R5), genera+cifra secreto, upsert (R6), retorna secreto una vez (R7), baja (R8), aislamiento por owner (R9).
- `lib/services/WebhookEstadoService.ts` — handler de entrega (zod, orden borrada→completa, sin sub→completa, descifra→firma→entrega, 2xx→complete, transitorio→lanza con detalle).
- `lib/services/jobs/webhook-estado-handler.ts` — `crearWebhookEstadoHandler` + `buildWebhookEstadoService`.
- `lib/services/jobs/webhook-estado-encolado.ts` — `EVENTOS_PUBLICOS` filter + §5 resolución (owner suscrito activo Y rol apiKey) + `dedupeKeyWebhookEstado` (con instante, obligatorio) + `MAX_INTENTOS_WEBHOOK=5` + `emisorWebhookEstadoReal`.

**Controller (Server Action, D1)**
- `lib/actions/webhooks.ts` — `registrarWebhook`/`desactivarWebhook` autorizadas a `maestro`, guard de owner rol apiKey (D3), secreto una vez; `config_error` si falta la clave de cifrado.

## Archivos modificados
- `db/schema.prisma` — `model WebhookSuscripcion`, enum `webhook_estado`, relación inversa en `Usuario`.
- `lib/repositories/registrar-cambio-estado.ts` — choke point: `tx` ensanchado a `OrdenHistorialTxClient & JobTxClient`, emisor inyectable con default real; emite en la MISMA tx tras el append (outbox, R10/R11/R16).
- `lib/repositories/OrdenHistorialRepository.ts` + `lib/interfaces/repositories/IOrdenHistorialRepository.ts` — `registrarCambioEstado` widen del `tx` (delegación al choke point).
- `app/api/cron/procesar-jobs/route.ts` — `handlers.set("webhook_estado", …)` en `buildHandlers` (NO en `buildRecurrencias`; `vercel.json` intacto).
- Tests existentes ajustados por el nuevo comportamiento del choke point / registro de handlers:
  - `tests/unit/api/procesar-jobs-registro.test.ts` y `tests/integration/api/procesar-jobs-geocodificacion.test.ts` — el set exacto de handlers ahora incluye `webhook_estado`.
  - `tests/unit/repositories/orden-repository.{asignacion,recepcion}-satelite.test.ts` — el choke point emite una sonda de elegibilidad EN LA MISMA tx (una `$queryRaw` extra, no-op sin owners suscritos); se relajó la aserción de conteo exacto de `$queryRaw`.
  - `tests/integration/db/zonas-migration.test.ts` — las dos migraciones nuevas añadidas a la whitelist de "apendidas después".

## Mapa R<n> → test

| R | Test |
| --- | --- |
| R1 | tests/integration/db/webhook-suscripcion-migracion.test.ts — "R1 — tabla webhook_suscripcion" |
| R2 | webhook-suscripcion-migracion.test.ts — "R2 — RLS de la tabla" |
| R3 | webhook-suscripcion-migracion.test.ts — "R3 — catalogo de tipos de job" |
| R4 | tests/integration/db/webhook-suscripcion-rollback.test.ts — "R4 — el rollback…" |
| R5 | tests/unit/services/webhook-suscripcion-service.test.ts — "R5 — validacion de URL" |
| R6 | webhook-suscripcion-service.test.ts "R6" + tests/integration/repositories/webhook-suscripcion-repository.test.ts "R6 — upsert por owner" |
| R7 | webhook-suscripcion-service.test.ts "R6/R7/R32" + webhook-suscripcion-repository.test.ts "findByOwner … NUNCA proyecta el secreto" |
| R8 | webhook-suscripcion-service.test.ts "R8 — baja" + webhook-suscripcion-repository.test.ts "R8 — desactivarByOwner" |
| R9 | webhook-suscripcion-service.test.ts "R9 — aislamiento por owner" + tests/unit/actions/webhooks-action.test.ts (autorización maestro) |
| R10 | tests/integration/repositories/orden-webhook-enqueue.test.ts — "R10" |
| R11 | orden-webhook-enqueue.test.ts — "R11 — si el cambio de estado falla no queda job huerfano" |
| R12 | orden-webhook-enqueue.test.ts — "R12 — solo owner rol apiKey con suscripcion activa" + webhook-estado-encolado.test.ts "R12" |
| R13 | tests/unit/services/webhook-estado-encolado.test.ts — "R13/R27 — payload minimo…" |
| R14 | webhook-estado-encolado.test.ts — "R14 — dedupeKey por evento unico" |
| R15 | webhook-estado-encolado.test.ts — "R15 — politica EVENTOS_PUBLICOS" |
| R16 | orden-webhook-enqueue.test.ts — "R16 — transiciones por dos mecanismos encolan por igual" |
| R17 | tests/unit/services/webhook-estado-service.test.ts — "R17/R19 — entrega y complete" |
| R18 | tests/unit/crypto/webhook-firma.test.ts — "R18 — firma HMAC-SHA256…" (+ verificación de firma en webhook-estado-service.test.ts) |
| R19 | webhook-estado-service.test.ts — "una respuesta 2xx completa el job" |
| R20 | webhook-estado-service.test.ts — "R20/R31 — transitorio -> lanza…" |
| R21 | webhook-estado-service.test.ts — "R21 — sin suscripcion activa" |
| R22 | webhook-estado-service.test.ts — "R22 — orden inexistente o borrada" |
| R23 | webhook-estado-service.test.ts — "R23 — idempotencia" |
| R24 | webhook-estado-service.test.ts — "R24 — aislamiento por owner" |
| R25 | orden-webhook-enqueue.test.ts — "R25 — con dos owners suscritos…" |
| R26 | tests/integration/api/procesar-jobs-webhook-estado.test.ts — "R26 — el drenador resuelve el handler…" |
| R27 | webhook-estado-encolado.test.ts — "R13/R27 — … maxIntentos=5" |
| R28 | tests/unit/config/webhook-config.test.ts — "R28 — config ausente/vacia -> defaults sin lanzar" |
| R29 | webhook-estado-service.test.ts "R29 — logs sin secreto/URL/PII" + webhook-sender.test.ts "R29 — el detalle de error nunca contiene la URL ni el cuerpo" |
| R30 | webhook-estado-service.test.ts — "R30 — payload invalido" |
| R31 | webhook-estado-service.test.ts "R20/R31" + procesar-jobs-webhook-estado.test.ts "un fallo transitorio persiste last_error via fail" |
| R32 | tests/unit/crypto/webhook-secret-cipher.test.ts (round-trip + clave ausente + integridad) + webhook-estado-service.test.ts "R32 — clave de cifrado ausente" + webhook-suscripcion-service.test.ts "R6/R7/R32" |

Los 32 requisitos con test concreto. Ninguno huérfano.

## Verificación

- `pnpm typecheck` → **exit 0** (limpio).
- `pnpm test` (suite completa) → **2 failed | 3990 passed (3992)**. Los 2 fallos son ambos `tests/components/HomePageRol.test.tsx` (render RSC del home por rol): **pre-existentes y ambientales** (ya fallaban en el baseline de `origin/dev` medido antes de tocar nada, por timeout/aislamiento de jsdom bajo carga); NO tocan nada de esta feature (home page/auth). Todos los tests de la feature 99 y las regresiones del choke point: verdes.
- Los archivos de test de la feature 99 (15 archivos) corren verdes de forma aislada y dentro de la suite.
- `db:migrate`/`db:rollback` reales NO se ejecutaron contra la DB compartida de Supabase (precedente 91/92): el SQL up/down se cubre con tests estáticos y el round-trip real es paso de deploy.

## NOTA PARA EL DEPLOY
Hay que setear **`WEBHOOK_SECRET_ENC_KEY`** en Vercel (clave AES-256-GCM de 32 bytes en base64 o hex) para que la entrega pueda firmar. Sin ella la config NO lanza (R28), pero cada job de entrega falla de forma recuperable (backoff) y espera a que la clave esté puesta; el secreto NUNCA se loguea. Opcionales: `WEBHOOK_TIMEOUT_MS` (default 10000), `WEBHOOK_REPLAY_WINDOW_S` (default 300). Nota: `.env.example` está gitignored en este repo — las tres entradas se documentan aquí; añadirlas al `.env.example` local no se commitea.

## Seguimientos anotados (design §11, fuera de alcance)
1. Purga de `jobs` (las filas `done` de `webhook_estado` crecen sin límite; con dedupeKey por instante es correcto pero no gratuito). Desbloqueo: política de retención de la cola.
2. Endurecimiento SSRF del sender (bloquear loopback/rangos privados). Desbloqueo: requisito de seguridad explícito.
3. Reintentos configurables por cliente + panel de entregas (tabla de entregas por-orden). Desbloqueo: pedido de producto.
4. N endpoints por owner (quitar el @unique + grano). Desbloqueo: pregunta abierta 1.
5. Rotación de `WEBHOOK_SECRET_ENC_KEY` (el prefijo `v1:` del ciphertext deja la puerta abierta). Desbloqueo: procedimiento de rotación.
6. **F100** (UI de registro en Configuración > API) ya está registrada como feature hermana (D4); consume `lib/actions/webhooks.ts`. Coordinar, no re-registrar.
