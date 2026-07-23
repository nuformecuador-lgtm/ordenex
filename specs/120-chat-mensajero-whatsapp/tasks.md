# Feature 109 — Tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con sus hermanos.
> Cada task lleva criterio de "hecho". Al final, el mapa R→test (regla del arnés: sin test
> que cubra un requisito, el reviewer rechaza). NO empezar hasta que la gate F1.4 resuelva
> D1–D6 (`design.md`).

## Bloque A — Datos y migración

- [x] **A1.** Añadir a `db/schema.prisma` los enums `ChatMensajeDireccion`,
  `ChatMensajeTipo`, `ChatMensajeEstado` y los modelos `ChatConversacion` y `ChatMensaje`
  (§1). *Hecho:* `pnpm db:generate` compila y los tipos aparecen en `@prisma/client`.
- [x] **A2.** Crear migración `db/migrations/<ts>_chat_whatsapp/migration.sql` (UP): enums,
  dos tablas, FKs, índice único parcial sobre `wa_message_id`, índices de §1.2/§1.3, y
  `ENABLE ROW LEVEL SECURITY` en ambas tablas (R15). Depende de A1. *Hecho:* migración
  aplica en DB de test sin error.
- [x] **A3.** Escribir `down.sql` que revierte EXACTAMENTE A2 (DROP TABLE en orden inverso
  por FKs, DROP TYPE de los enums) (R15). Depende de A2. *Hecho:* `pnpm db:rollback` deja el
  esquema como antes.

## Bloque B — Config y borde tipado

- [x] **B1. [P]** `loadWhatsappWebhookConfig()` que lee `WHATSAPP_WEBHOOK_VERIFY_TOKEN` y
  `WHATSAPP_APP_SECRET` con `readRequired` (cita nombre, nunca valor) lanzando
  `WhatsappNoConfiguradoError` (R12). *Hecho:* test B1.T verde.
- [x] **B2. [P]** Esquema zod del payload de Meta en `lib/types/whatsapp-webhook.ts` con
  strip de campos extra; normaliza a un tipo de dominio (mensajes entrantes + statuses)
  (R5). *Hecho:* test B2.T verde.

## Bloque C — Repositorios e interfaces

- [x] **C1. [P]** Interfaces `IChatConversacionRepository` / `IChatMensajeRepository` en
  `lib/interfaces/repositories/`. Depende de A1. *Hecho:* typecheck ok.
- [x] **C2.** `ChatConversacionRepository` y `ChatMensajeRepository` (solo Prisma): upsert de
  hilo, insert idempotente de mensaje (dedupe `wa_message_id`), update de `estado` por
  `wa_message_id`, listar hilo por `ordenId` con scope `mensajeroId`. Depende de C1.
  *Hecho:* tests de repo (integration) verdes.

## Bloque D — Service (lógica pura)

- [x] **D1.** `ChatWhatsappService` (`lib/services/ChatWhatsappService.ts`): ingesta de
  entrantes (R6), aplicación de statuses (R7), dedupe (R8), resolución de hilo desde número
  (R25/D4), regla de ventana 24 h (R18/R19/D2), orquestación del envío saliente (R20/R21).
  Deps por constructor (repos + `WhatsappCloudClient`). Depende de C2, B2. *Hecho:* tests
  unit del service verdes (sin DB ni HTTP).

## Bloque E — Webhook (Controller)

- [x] **E1.** `app/api/webhooks/whatsapp/route.ts` GET: handshake (R1/R2) contra
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Depende de B1. *Hecho:* test E1.T verde.
- [x] **E2.** `route.ts` POST: leer cuerpo crudo, verificar `X-Hub-Signature-256` con
  `timingSafeEqual` ANTES de procesar (R3/R4), zod strip (R5), delegar al service (R6/R7/R8),
  responder 200 (R9), sin log de secretos/PII (R11). Depende de D1, E1, B2. *Hecho:* tests
  E2.T verdes.
- [x] **E3.** Añadir `/api/webhooks` a `SELF_AUTH_ROUTES` en `middleware.ts` con comentario
  del matcher (R10). Depende de E2. *Hecho:* test E3.T (integration) confirma que el POST no
  redirige a `/login`.

## Bloque F — Envío saliente (Server Actions)

- [x] **F1.** `lib/actions/chat-whatsapp.ts`: `enviarMensajeChat(ordenId, texto)` con
  resolución de actor + scope `OrdenEnvioReader` (R17), ventana 24 h (R18/R19), persistencia
  saliente (R20), manejo de `transitorio` según D1 (R21). Depende de D1. *Hecho:* tests
  F1.T verdes.
- [x] **F2. [P]** `listarHiloChat(ordenId)` con scope del mensajero (R16/R22). Depende de C2.
  *Hecho:* test F2.T verde.
- [x] **F3. (condicional D1)** Si D1 = encolar: `JobTipo whatsapp_chat_envio` + handler en
  `lib/services/jobs/` registrado en `procesar-jobs/route.ts` para reintento de
  `transitorio` (R21). Depende de F1. *Hecho:* test de registro del handler verde.

## Bloque G — UI

- [ ] **G1.** `ChatWhatsappPanel.tsx` en `mis-asignaciones/_components/`: historial ordenado,
  burbujas entrante/saliente, badge de estado (R22). Depende de F2. *Hecho:* test de
  componente G1.T verde.
- [ ] **G2.** Control de input según ventana 24 h + fallback a `EnviarPlantillaWhatsappButton`
  (R23). Depende de G1. *Hecho:* test G2.T verde.
- [ ] **G3.** Refresco del hilo según D5 (SWR `refreshInterval`) (R24). Depende de G1.
  *Hecho:* test G3.T verde.
- [ ] **G4.** Enganchar `ChatWhatsappPanel` en `GestionarOrdenPanel`. Depende de G1.
  *Hecho:* la vista de asignación renderiza el chat.

## Bloque H — Verificación final

- [x] **H1.** `.env.example` documenta las dos variables nuevas (D6/R12, sin valores).
- [ ] **H2.** `./init.sh` en verde + suite de tests completa. *Hecho:* CI local verde.
- [ ] **H3.** Actualizar `progress/impl_109.md` con el mapa R→test completo.

---

## Mapa R → test (trazabilidad)

| Requisito | Test | Tipo |
| --- | --- | --- |
| R1 | E1.T `responde 200 con challenge cuando mode=subscribe y token válido` | integration |
| R2 | E1.T `responde 403 cuando el token no coincide o falta` | integration |
| R3 | E2.T `verifica la firma antes de procesar` | integration |
| R4 | E2.T `responde 401 y no persiste cuando la firma es inválida/ausente` | integration |
| R5 | B2.T `descarta campos extra del payload de Meta` | unit |
| R6 | D1.T `registra cada mensaje entrante en su hilo` | unit |
| R7 | D1.T `actualiza el estado de entrega del saliente por wa_message_id` | unit |
| R8 | D1.T `no duplica ante wa_message_id ya registrado` | unit + C2 repo |
| R9 | E2.T `responde 200 aunque un evento no mapee a hilo` | integration |
| R10 | E3.T `el POST del webhook no redirige a /login` | integration |
| R11 | E2.T `no loguea token/secreto/número en éxito ni error` | integration |
| R12 | B1.T `lanza citando el nombre de la variable ausente` | unit |
| R13 | C2 `upsert de hilo por orden+número guarda ultimo_entrante_at` | integration |
| R14 | C2 `persiste dirección/tipo/cuerpo/wa_message_id/estado` | integration |
| R15 | A2/A3 `migración aplica y down.sql revierte; RLS habilitada` | integration/migración |
| R16 | F2.T `solo devuelve hilos de las órdenes del mensajero` | unit/integration |
| R17 | F1.T `rechaza si la orden no está asignada al actor` | unit |
| R18 | D1.T `permite texto libre dentro de la ventana de 24 h` | unit |
| R19 | D1.T `bloquea texto libre y exige plantilla fuera de la ventana` | unit |
| R20 | F1.T `persiste el saliente con wa_message_id cuando ok` | unit |
| R21 | F1.T `trata transitorio como reintentable sin filtrar secretos` | unit |
| R22 | G1.T `muestra historial ordenado con entrante/saliente y estado` | component |
| R23 | G2.T `input habilitado dentro / plantilla fuera de la ventana` | component |
| R24 | G3.T `refresca el hilo sin recarga manual` | component |
| R25 | D1.T `resuelve la orden por número y no rompe el 200 si no resuelve` | unit |
</content>
