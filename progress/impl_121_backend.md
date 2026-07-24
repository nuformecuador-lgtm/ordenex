# Feature 121 — Ubicacion en el chat WhatsApp · BACKEND (bloques A–E)

> Rama `flow` (extiende WIP feature 120). Alcance backend del spec
> `specs/121-ubicacion-chat-whatsapp/`. Sin commits (los hace el leader). Sin ejecutar la
> migracion contra ninguna DB (el `.env` apunta a DB compartida; se aplica post-merge a mano,
> igual que la 120). Decision F1.4 P1 respetada: SOLO lat/lng; `name`/`address` de Meta se
> strip-ean.

## Archivos creados / modificados

### Datos y migracion (bloque A)
- `db/schema.prisma` — enum `ChatMensajeTipo` += `ubicacion`; modelo `ChatMensaje` +=
  `latitud Float? @map("latitud")` / `longitud Float? @map("longitud")`. `pnpm db:generate` OK.
- `db/migrations/20260724120000_chat_mensaje_ubicacion/migration.sql` (UP) — `ALTER TYPE ... ADD
  VALUE IF NOT EXISTS 'ubicacion'` + `ADD COLUMN latitud/longitud DOUBLE PRECISION`, con el GOTCHA
  55P04 documentado.
- `db/migrations/20260724120000_chat_mensaje_ubicacion/down.sql` (DOWN) — `DROP COLUMN` de ambas
  columnas + recreacion del enum sin `ubicacion` (patron feature 106), precondicion "0 filas
  tipo=ubicacion" documentada.

### Borde tipado del webhook (bloque B)
- `lib/types/whatsapp-webhook.ts` — `location: z.object({ latitude, longitude }).optional()
  .catch(undefined)` en `metaMessageSchema` (una coord no numerica degrada el location a
  `undefined` en vez de romper el lote, R3); `WebhookMensajeEntrante.ubicacion?`; helper puro
  exportado `esCoordenadaValida` (lat∈[-90,90], lng∈[-180,180]); `tipoDeMeta` reconoce
  `"location"`; `parseWebhookEventos` normaliza a `tipo:"ubicacion"` con coords o degrada a
  `"otro"` sin coords (R1/R2/R3). No loguea coords ni numero.

### Repositorio e interfaz (bloque C)
- `lib/interfaces/repositories/IChatMensajeRepository.ts` — `latitud?/longitud?` en
  `InsertarEntranteInput`; `latitud/longitud: number|null` en `ChatMensajeDTO`.
- `lib/repositories/ChatMensajeRepository.ts` — lat/lng en `SELECT`, `Row`, `toDTO` y en el `data`
  del insert idempotente (salientes quedan null). Dedupe por `wa_message_id` intacto.

### Service (bloque D)
- `lib/services/ChatWhatsappService.ts` (`ingerirEventos`) — propaga
  `latitud: mensaje.ubicacion?.latitud ?? null` / `longitud` al `insertarEntranteIdempotente`.
  Dedupe y `marcarUltimoEntrante` (solo si `insertado===true`) sin tocar (R5/R6).

### Contrato hacia la UI (bloque E)
- `lib/types/chat-whatsapp.ts` — `ChatMensajeVista` += `latitud/longitud: number|null`.
- `lib/actions/chat-whatsapp.ts` (`listarHiloChat`) — mapea ambos campos del DTO a la vista.
  Scope por mensajero (R16) reutilizado, no reimplementado.

### Tests
- `tests/unit/types/whatsapp-webhook.test.ts` — extendido (B1.T + R15 logs).
- `tests/unit/services/chat-whatsapp-service.test.ts` — extendido (D1.T + R15 logs); DTO literals
  del 120 completados con `latitud/longitud: null` (ripple del contrato).
- `tests/unit/repositories/chat-mensaje-repository.test.ts` — extendido (C2.T).
- `tests/unit/actions/chat-whatsapp-actions.test.ts` — extendido (E1.T: R8 + R16).
- `tests/integration/db/chat-mensaje-ubicacion-migration.test.ts` — NUEVO (A2/A3, R7, forma
  estatica de migration.sql/down.sql, patron del test de la feature 106).
- `tests/components/ChatWhatsappPanel.test.tsx` — SOLO fixtures `ChatMensajeVista` completados con
  `latitud/longitud: null` para que compile el typecheck tras el cambio de contrato (sin tocar
  logica de UI; el componente lo implementa frontend_dev).

## Mapa R -> test (requisitos backend)

| R | Test | Archivo |
| --- | --- | --- |
| R1 | `R1: normaliza type=location con coords validas a tipo ubicacion con lat/lng` | whatsapp-webhook.test.ts |
| R2 | `R2: descarta name/address del objeto location sin romper el parseo` | whatsapp-webhook.test.ts |
| R3 | `esCoordenadaValida` + `R3: location sin coords/no numerica/fuera de rango degrada a otro sin coords y no lanza` (3 casos) | whatsapp-webhook.test.ts |
| R4 | `R4: registra el entrante de ubicacion con lat/lng en el hilo` + `R4: insertarEntranteIdempotente persiste lat/lng` / `entrante SIN coords guarda null` | chat-whatsapp-service.test.ts + chat-mensaje-repository.test.ts |
| R5 | `R5/R6: una ubicacion deduplicada no re-sella la ventana` + `R5: el dedupe (count 0) sigue omitiendo el reenvio de una ubicacion` | chat-whatsapp-service.test.ts + chat-mensaje-repository.test.ts |
| R6 | `R6: un entrante de ubicacion NUEVO sella ultimo_entrante_at` + `R5/R6 dedup no re-sella` | chat-whatsapp-service.test.ts |
| R7 | `Feature 121 · UP/DOWN/schema/estructura` (forma estatica de la migracion) | chat-mensaje-ubicacion-migration.test.ts |
| R8 | `R8: expone lat/lng en los entrantes de ubicacion y null en los demas` + `R8: listarHilo mapea latitud/longitud del DTO` | chat-whatsapp-actions.test.ts + chat-mensaje-repository.test.ts |
| R15 | `R15: el normalizador no vuelca lat/lng ni el numero a console` + `R15: la ingesta de ubicacion no vuelca coords ni numero a console` | whatsapp-webhook.test.ts + chat-whatsapp-service.test.ts |
| R16 | `R16: sigue rechazando (forbidden) el hilo de una orden de otro mensajero (scope reutilizado)` | chat-whatsapp-actions.test.ts |

(R9–R14 son frontend; los implementa frontend_dev.)

## Verificacion (salida real)

- `pnpm db:generate` — OK (Prisma Client v7.8.0 generado; `ChatMensajeTipo.ubicacion` disponible).
- `pnpm typecheck` — sin errores atribuibles a esta feature. Ruido PREEXISTENTE ajeno en la rama
  `flow` (otras WIP): `lib/auth/google-adc-token.ts` / `google-wif-token.ts`
  (`google-auth-library`, `@vercel/oidc` sin instalar) y `tests/unit/auth/middleware.test.ts`
  (`Promise<NextResponse>` — middleware modificado por otra sesion). `grep` de
  chat/whatsapp/webhook/mensaje/ubicac/latitud/longitud sobre la salida: 0 lineas.
- `pnpm eslint` sobre los 11 archivos tocados — 0 findings.
- Tests de la feature + 120 (ripple):
  ```
  pnpm vitest run tests/unit/types/whatsapp-webhook.test.ts \
    tests/unit/services/chat-whatsapp-service.test.ts \
    tests/unit/repositories/chat-mensaje-repository.test.ts \
    tests/unit/actions/chat-whatsapp-actions.test.ts \
    tests/integration/db/chat-mensaje-ubicacion-migration.test.ts \
    tests/unit/repositories/chat-conversacion-repository.test.ts
  => Test Files  6 passed (6) | Tests  80 passed (80)
  ```

## Veredicto

Backend de la feature 121 (bloques A–E) implementado y verificado: 80/80 tests verdes, typecheck y
lint limpios en lo tocado, migracion up/down con su forma cubierta por test; frontend (R9–R14) queda
para frontend_dev.
