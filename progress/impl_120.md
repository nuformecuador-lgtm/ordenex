# impl 120 — Chat del mensajero ↔ cliente vía WhatsApp (BACKEND: bloques A, B, C, D, E, F, H1)

> Alcance backend. El bloque G (UI) es de frontend_dev y NO se toca aquí.

## Archivos creados

**Datos / migración (A)**
- `db/schema.prisma` — enums `ChatMensajeDireccion`/`ChatMensajeTipo`/`ChatMensajeEstado`, modelos `ChatConversacion` y `ChatMensaje`, relaciones inversas en `Orden` y `Usuario`, valor `whatsapp_chat_envio` en `JobTipo`.
- `db/migrations/20260723130000_chat_whatsapp/migration.sql` + `down.sql` — enums, 2 tablas, FKs, índice único PARCIAL sobre `wa_message_id`, índices, `ENABLE ROW LEVEL SECURITY`.
- `db/migrations/20260723130100_job_tipo_whatsapp_chat_envio/migration.sql` + `down.sql` — add del valor de enum (aparte por 55P04).

**Config y borde tipado (B)**
- `lib/config/whatsapp.ts` — `loadWhatsappWebhookConfig()` (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, cita nombre nunca valor).
- `lib/types/whatsapp-webhook.ts` — zod strip del payload de Meta + normalización a `WebhookEventos`.

**Repositorios e interfaces (C)**
- `lib/interfaces/repositories/IChatConversacionRepository.ts`, `lib/interfaces/repositories/IChatMensajeRepository.ts`
- `lib/repositories/ChatConversacionRepository.ts`, `lib/repositories/ChatMensajeRepository.ts`

**Service (D)**
- `lib/services/ChatWhatsappService.ts` — ingesta (D4/dedupe), statuses, ventana 24 h (D2), envío en línea + encolado del reintento (D1), reintento del job.

**Webhook (E)**
- `app/api/webhooks/whatsapp/route.ts` — GET handshake, POST con HMAC `timingSafeEqual` sobre cuerpo crudo, zod strip, 200.
- `middleware.ts` — `/api/webhooks` añadido a `SELF_AUTH_ROUTES` (E3).

**Server Actions + job (F)**
- `lib/actions/chat-whatsapp.ts` — `enviarMensajeChat` (scope `OrdenEnvioReader`, ventana, transitorio) y `listarHiloChat` (scope mensajero).
- `lib/services/jobs/whatsapp-chat-envio-encolado.ts`, `lib/services/jobs/whatsapp-chat-envio-handler.ts`
- `app/api/cron/procesar-jobs/route.ts` — registro del handler `whatsapp_chat_envio`.
- `lib/types/chat-whatsapp.ts` — DTOs de la frontera action↔UI.

**Docs (H1)**
- `.env.example` — documenta las variables WhatsApp (incluye las dos nuevas del webhook, sin valores).

## Archivos modificados (tests existentes)
- `tests/unit/api/procesar-jobs-registro.test.ts`, `tests/integration/api/procesar-jobs-geocodificacion.test.ts`, `tests/integration/api/procesar-jobs-webhook-estado.test.ts` — key-set de handlers actualizado con `whatsapp_chat_envio`.

## Tests nuevos y mapa R → test

| R | Test | Archivo |
| --- | --- | --- |
| R1 | responde 200 con challenge (mode=subscribe, token válido) | tests/integration/api/webhook-whatsapp.route.test.ts |
| R2 | 403 cuando el token no coincide / falta hub.mode | tests/integration/api/webhook-whatsapp.route.test.ts |
| R3 | firma válida delega en el service y responde 200 | tests/integration/api/webhook-whatsapp.route.test.ts |
| R4 | firma inválida/ausente → 401 sin procesar | tests/integration/api/webhook-whatsapp.route.test.ts |
| R5 | descarta campos extra del payload de Meta | tests/unit/types/whatsapp-webhook.test.ts |
| R6 | registra cada entrante en su hilo y sella la ventana | tests/unit/services/chat-whatsapp-service.test.ts + tests/unit/repositories/chat-mensaje-repository.test.ts |
| R7 | actualiza el estado del saliente por wa_message_id | tests/unit/services/chat-whatsapp-service.test.ts + chat-mensaje-repository.test.ts |
| R8 | no duplica ante wa_message_id ya registrado (dedupe) | chat-mensaje-repository.test.ts + chat-whatsapp-service.test.ts |
| R9 | 200 aunque un evento no mapee / forma no-Meta | webhook-whatsapp.route.test.ts + chat-whatsapp-service.test.ts |
| R10 | el POST/GET del webhook no redirige a /login | tests/integration/api/webhook-whatsapp-middleware.test.ts |
| R11 | no loguea token/secreto/número en éxito ni error | webhook-whatsapp.route.test.ts |
| R12 | lanza citando el nombre de la variable ausente | tests/unit/config/whatsapp-webhook-config.test.ts |
| R13 | upsert de hilo por orden+número; sella ultimo_entrante_at | chat-conversacion-repository.test.ts |
| R14 | persiste dirección/tipo/cuerpo/wa_message_id/estado | chat-mensaje-repository.test.ts |
| R15 | migración con RLS + down.sql (revisión SQL) | db/migrations/20260723130000_chat_whatsapp/ |
| R16 | solo devuelve hilos de las órdenes del mensajero | chat-whatsapp-actions.test.ts + chat-conversacion-repository.test.ts |
| R17 | rechaza si la orden no está asignada al actor | tests/unit/actions/chat-whatsapp-actions.test.ts |
| R18 | permite texto libre dentro de la ventana de 24 h | tests/unit/services/chat-whatsapp-service.test.ts |
| R19 | bloquea texto libre y exige plantilla fuera de la ventana | chat-whatsapp-service.test.ts + chat-whatsapp-actions.test.ts |
| R20 | persiste el saliente con wa_message_id cuando ok | chat-whatsapp-service.test.ts + chat-whatsapp-actions.test.ts |
| R21 | trata transitorio como reintentable sin filtrar secretos | chat-whatsapp-service.test.ts + chat-whatsapp-actions.test.ts |
| R25 | resuelve la orden por número; no rompe el 200 si no resuelve | chat-whatsapp-service.test.ts + chat-conversacion-repository.test.ts |
| F3 | encolado (dedupeKey/tipo) + handler delega en reintentarEnvio | tests/integration/api/procesar-jobs-whatsapp-chat-envio.test.ts |

R22/R23/R24 son de la UI (bloque G, frontend_dev). R23 tiene además cobertura server-side de la ventana en `chat-whatsapp-actions.test.ts` (`ventanaAbierta`).

## Verificación

**typecheck** (`pnpm run typecheck`): 30 errores, TODOS del baseline preexistente ajeno
(`MisAsignacionesModule.tsx`, `MisAsignacionesModule.test.tsx`, `middleware.test.ts` async,
`fallback-route-optimization.ts(.test.ts)` por `google-token-shared` sin commitear).
**Delta = 0**: ningún error nuevo fuera de esos 30 (verificado con filtro por archivo).

**tests nuevos** (`pnpm vitest run <9 archivos>`): **9 passed / 54 tests passed**.

Nota F3: el registro-en-ruta (`buildHandlers`) se afirma en los tres tests hermanos
`procesar-jobs-*.test.ts` (ya actualizados con la nueva clave). Esos ficheros son HOY
un-importables en el entorno de test por el mismo baseline preexistente (la ruta importa
transitivamente `@/lib/auth/google-token-shared`, un archivo google sin commitear); quedarán
verdes al restaurarse ese módulo post-merge. Mi test F3 aislado (encolado + handler) no
depende de la ruta y pasa.

Nota A2/A3: por instrucción, la migración NO se aplica a la DB (compartida LIVE). El schema
se validó con `pnpm db:generate` (no conecta). El `migration.sql`/`down.sql` siguen el patrón
`wallet_movimiento` (índice parcial a mano) y `plantilla_mensaje` (RLS) / `job_tipo_*` (down).

## Veredicto
Backend de la feature 120 completo (A–F, H1), typecheck con delta cero y 54 tests nuevos en verde.

---

## Bloque G — UI (frontend_dev)

**Archivos creados/tocados:**
- `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx` (nuevo, `'use client'`).
- `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` (G4: import + montaje del
  panel en el paso "detalle", bajo los botones de contacto).
- `tests/components/ChatWhatsappPanel.test.tsx` (nuevo, 3 tests).

**Diseño:** panel co-ubicado (un solo consumidor, §5). Consume las Server Actions del backend
(`listarHiloChat` / `enviarMensajeChat`) — sin `fetch` a `/api/*`. Primitivas shadcn/ui
reutilizadas: `Badge` (estado de entrega), `Input`, `Button`. Fallback fuera de ventana =
`EnviarPlantillaWhatsappButton` (feature 107). Refresco D5 con `useSWR` `refreshInterval`=10 s.

**Mapa R→test (component):**
| Requisito | Test (G) | Nombre |
| --- | --- | --- |
| R22 | G1.T | `muestra historial ordenado con entrante/saliente y estado` |
| R23 | G2.T | `habilita el input dentro de la ventana y ofrece plantilla fuera de ella` |
| R24 | G3.T | `refresca el hilo sin recarga manual` |

**typecheck** (`pnpm run typecheck`): 30 errores, TODOS del baseline preexistente ajeno
(`_baseline_typecheck_120.txt`). **Delta = 0**: ningún error nuevo en `ChatWhatsappPanel.tsx`,
`GestionarOrdenPanel.tsx` ni el test.

**tests** (`pnpm vitest run tests/components/ChatWhatsappPanel.test.tsx`): **3 passed / 3**.

## Veredicto (bloque G)
UI del chat (G1–G4) completa: panel enganchado en `GestionarOrdenPanel`, ventana de 24 h y
refresco SWR; delta de typecheck cero y 3 tests de componente en verde.

---

## Bloque H (append) — enviar PLANTILLA por el chat y persistirla en el hilo

**Objetivo:** camino de envio de una PLANTILLA aprobada POR EL CHAT (para escribir fuera de la
ventana de 24 h, donde Meta rechaza el texto libre). Reutiliza la logica de la feature 107
(mapeo variables->orden + construccion de componentes Graph API), sin reinventarla.

**Archivos creados/modificados:**
- `lib/actions/chat-whatsapp.ts` — nueva Server Action `enviarPlantillaChat(ordenId, plantillaId)`:
  resuelve actor por sesion, valida propiedad con `OrdenEnvioReader`, carga la plantilla enviable,
  mapea variables/componentes/cuerpo renderizado y delega en el service. NO aplica bloqueo de
  ventana (la plantilla sirve dentro Y fuera). `transitorio` -> reintentable sin filtrar detalle.
- `lib/services/ChatWhatsappService.ts` — nuevo metodo puro `enviarPlantilla(input)`: upsert del
  hilo, envio via `client.enviarPlantilla`, persistencia del saliente `tipo=plantilla` con
  `plantilla_id`, cuerpo renderizado y `wa_message_id` (`sent`) o `queued`+encolado (`transitorio`).
  `ChatClient` ampliado a `enviarTexto | enviarPlantilla`.
- `lib/types/chat-whatsapp.ts` — nuevo tipo `EnviarPlantillaChatResult` (lo consume la UI).
- `lib/interfaces/repositories/IPlantillaMensajeRepository.ts` + `lib/repositories/PlantillaMensajeRepository.ts`
  — `PlantillaEnviable` ahora incluye `cuerpo` (para renderizar el texto del historial);
  `findEnviableById` y `listarEnviables` lo seleccionan.
- `tests/unit/services/chat-whatsapp-service.test.ts` — `fakeClient` con `enviarPlantilla` + 4 tests nuevos.
- `tests/unit/actions/chat-whatsapp-actions.test.ts` — 7 tests nuevos de la action.

**Firma exacta de la Server Action (la UI consume esto):**
```ts
enviarPlantillaChat(ordenId: unknown, plantillaId: unknown, deps?: ChatWhatsappDeps): Promise<EnviarPlantillaChatResult>

type EnviarPlantillaChatResult =
  | { status: "ok"; mensajeChatId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }        // plantilla inexistente o no enviable
  | { status: "no_configurado" }
  | { status: "transitorio"; mensajeChatId: string };
```

**Mapa test:**
| Caso | Test |
| --- | --- |
| Envio OK persiste saliente `tipo=plantilla` con `plantilla_id`+`wa_message_id` | service: `ok: persiste el saliente tipo plantilla...`; action: `ok: mapea variables->orden...` |
| Rechazo si la orden no es del actor | action: `rechaza (forbidden) si la orden no esta asignada...` |
| Plantilla no enviable -> not_found | action: `plantilla inexistente / no enviable -> not_found...` |
| `transitorio` reintentable sin filtrar secretos | service: `transitorio: persiste queued...`; action: `transitorio: reintentable, sin filtrar el detalle...` |
| Se permite dentro Y fuera de la ventana | service: `se puede enviar FUERA de la ventana...` + `...SIN ningun entrante`; action: `se permite dentro Y fuera de la ventana...` |
| Sin credencial -> no_configurado | action: `service null (sin credencial) -> no_configurado` |

**typecheck** (`pnpm run typecheck`): **0 errores**.
**tests** (`pnpm vitest run tests/unit/services/chat-whatsapp-service.test.ts tests/unit/actions/chat-whatsapp-actions.test.ts`): **32 passed / 32**.
**suite completa** (`pnpm vitest run`): 4711 passed; 1 fallo flaky ajeno
(`recuperar-contrasena-form.test.tsx`, pasa en aislamiento, no toca mi codigo).

## Veredicto (bloque H)
`enviarPlantillaChat` enviada y persistida en el hilo como saliente `tipo=plantilla`; typecheck
en 0 y 11 tests nuevos en verde, sin filtrar token/numero.
