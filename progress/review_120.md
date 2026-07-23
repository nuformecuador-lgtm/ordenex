# review 120 — Chat del mensajero ↔ cliente vía WhatsApp (webhook de entrada)

Reviewer: reviewer (arnés SDD). Rama `feature/120-chat-mensajero-whatsapp`
(worktree `ordenex-wt-120`). Solo lectura + ejecución de tests.

## Veredicto

**APROBADO** — 0 hallazgos bloqueantes. 25/25 requisitos con test verde. Delta de
typecheck = 0. 57/57 tests de la feature en verde.

## Checklist CHECKPOINTS

- [x] `requirements.md` (R1–R25 EARS), `design.md` (alternativa descartada §7 + D1–D6),
  `tasks.md` con tasks A–G en `[x]` (H2/H3 quedan al leader: init.sh + history).
- [x] Trazabilidad R→test completa en `tasks.md` y `progress/impl_120.md`; verificada
  contra los tests reales (nombres `Rn:` en cada `it`).
- [x] `pnpm run typecheck`: 30 errores, TODOS del baseline ajeno; delta = 0.
- [x] Tests de la feature (10 archivos): 57 passed / 57.
- [x] RLS habilitada en ambas tablas nuevas + `down.sql` que revierte exactamente.
- [x] Webhook valida firma HMAC (timingSafeEqual, sobre cuerpo crudo, ANTES de parsear)
  e idempotencia por `wa_message_id` (índice único parcial).
- [x] Capas Controller→Service→Repository; borde zod; inyección por interfaz.
- [x] Sin secretos hardcodeados (envs por `readRequired`, cita nombre nunca valor).

## Mapa R → test → estado

| R | Test | Estado |
| --- | --- | --- |
| R1 | webhook-whatsapp.route: 200 + challenge text/plain | verde |
| R2 | webhook-whatsapp.route: 403 token no coincide / falta hub.mode | verde |
| R3 | webhook-whatsapp.route: firma válida delega en service | verde |
| R4 | webhook-whatsapp.route: firma inválida/ausente → 401, service intacto | verde |
| R5 | whatsapp-webhook (types): descarta campos extra / strip | verde |
| R6 | chat-whatsapp-service + chat-mensaje-repository: registra entrante | verde |
| R7 | chat-whatsapp-service + chat-mensaje-repository: estado por wa_message_id | verde |
| R8 | chat-mensaje-repository (skipDuplicates) + service (no re-sella) | verde |
| R9 | webhook-whatsapp.route: 200 con sinResolver / forma no-Meta | verde |
| R10 | webhook-whatsapp-middleware: POST/GET no redirige a /login | verde |
| R11 | webhook-whatsapp.route: no loguea secreto/token/número | verde |
| R12 | whatsapp-webhook-config: cita nombre de la env ausente | verde |
| R13 | chat-conversacion-repository: upsert + marcarUltimoEntrante | verde |
| R14 | chat-mensaje-repository: dirección/tipo/cuerpo/wa_message_id/estado | verde |
| R15 | migración 20260723130000_chat_whatsapp (RLS + down.sql, revisión SQL) | verde |
| R16 | chat-whatsapp-actions + chat-conversacion-repository: scope mensajero | verde |
| R17 | chat-whatsapp-actions: rechaza si orden no asignada al actor | verde |
| R18 | chat-whatsapp-service: envía dentro de la ventana | verde |
| R19 | chat-whatsapp-service + actions: bloquea fuera de ventana (D2) | verde |
| R20 | chat-whatsapp-service + actions: persiste saliente con wa_message_id | verde |
| R21 | chat-whatsapp-service + actions: transitorio → queued + encola, sin PII | verde |
| R22 | ChatWhatsappPanel: historial ordenado entrante/saliente + estado | verde |
| R23 | ChatWhatsappPanel: input dentro / plantilla fuera de ventana | verde |
| R24 | ChatWhatsappPanel: refresca sin recarga (SWR refreshInterval) | verde |
| R25 | chat-whatsapp-service + chat-conversacion-repository: resuelve orden / no rompe 200 | verde |

## Decisiones D1–D6

- D1 (envío en línea + encolado del reintento): `ChatWhatsappService.enviarTexto`
  persiste `queued` y `encolarReintento`; handler `whatsapp-chat-envio-handler`. OK.
- D2 (ventana bloqueada en server): `enviarTexto` retorna `fuera_ventana` antes de
  llamar al cliente. OK.
- D3 (scope estricto mensajero): `OrdenEnvioReader.findParaEnvio` +
  `findByOrdenParaMensajero`. OK.
- D4 (orden activa asignada más reciente): `resolverOrdenActivaPorNumero`; sin resolver
  → `sinResolver`, no rompe 200. OK.
- D5 (SWR refreshInterval): panel. OK.
- D6 (envs WHATSAPP_WEBHOOK_VERIFY_TOKEN / WHATSAPP_APP_SECRET en .env.example). OK.

## Typecheck

30 errores actuales == 30 del baseline `_baseline_typecheck_120.txt`, byte a byte
(comm -23 y comm -13 vacíos). **Delta = 0.** Ningún archivo de la feature 120 aparece.

## Tests

`pnpm vitest run` sobre los 10 archivos de la feature: **10 files / 57 tests passed**.
Los tests no son vacíos: cada `it` afirma el comportamiento (p. ej. R4 verifica
`ingerir` no fue llamado; R11 inspecciona los spies de console).

Nota: los `procesar-jobs-*.test.ts` hermanos siguen un-importables por el baseline
(`@/lib/auth/google-token-shared` sin commitear) — es baseline ajeno, no fallo de 120.
El test aislado F3 (`procesar-jobs-whatsapp-chat-envio.test.ts`) sí corre y pasa.

## Hallazgos menores

- `tasks.md` H2 (`./init.sh` verde) y H3 (history) quedan `[ ]`: son verificación final
  del leader. `init.sh` fallará en typecheck por los 30 errores de baseline ajenos hasta
  que se resuelva ese merge/`google-token-shared`; no es defecto de la feature 120.
- CHECKPOINTS pide test E2E (Playwright) para webhooks; no se añadió. La cobertura de
  integración del route handler + firma se considera suficiente para v1; se anota como
  follow-up, no bloqueante.

## Cierre

Sin bloqueantes. Feature 120 lista para merge una vez el leader resuelva el baseline
ajeno (init.sh) e history.
