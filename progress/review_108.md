# Review 108 — Registrar webhook en el alta de la API key + botón de fila "Editar"

Reviewer. Verificación (no edición). Worktree `ordenex-wt-108`, rama
`feature/108-webhook-en-alta-apikey`.

## Veredicto

**APROBADO** — 0 bloqueantes.

## Checklist CHECKPOINTS

- [x] `requirements.md` con EARS numerados R1–R20.
- [x] `design.md` con alternativa descartada (registrar webhook en el servidor dentro
  de `generarApiKey`) y su porqué.
- [x] `tasks.md` con todas las tasks T1–T7 marcadas `[x]`.
- [x] Cada R1–R20 mapea a un test concreto y REAL (tabla abajo).
- [x] `progress/impl_108.md` contiene el mapa R→test con nombres reales.
- [x] `pnpm typecheck` sin errores.
- [x] `pnpm lint` 0 errores (144 warnings preexistentes; ninguno nuevo bloqueante).
- [x] Tests del módulo API verdes.
- [x] Sin tabla nueva / migración / secreto hardcodeado / cambio de backend (frontend puro).
- [x] Secretos solo en estado local; se descartan al cerrar; no se loguean.
- N/A RLS / down.sql / capas backend: la feature no toca backend, DB ni Server Actions.

## Trazabilidad R → test

| R | Test | Archivo | Estado |
| --- | --- | --- | --- |
| R1 | "R1/R20: muestra el campo opcional de URL de webhook con label accesible" | GenerarApiKeyForm.test.tsx | OK |
| R2 | "R2: con URL vacía genera la key y NO llama a registrarWebhook" | ApiKeysModule.test.tsx | OK |
| R3 | "R3: propaga la URL https válida…" / "R3: con URL vacía valida solo el identificador" | GenerarApiKeyForm.test.tsx | OK |
| R4 | "R4: con URL no-https marca error de campo y no invoca generarApiKey ni registrarWebhook" | ApiKeysModule + GenerarApiKeyForm | OK |
| R5 | "R5: tras ok encadena registrarWebhook con ownerUsuarioId = apiKey.usuarioId y la URL" | ApiKeysModule.test.tsx | OK |
| R6 | "R6: bloquea el segundo submit mientras corren las dos acciones encadenadas" | ApiKeysModule.test.tsx | OK |
| R7 | "R7: sin webhook, revela solo el secreto de la key una vez" | ApiKeysModule.test.tsx | OK |
| R8 | "R8: con webhook creado revela clave y secreto en un solo modal" | RevelarSecretosModal + ApiKeysModule | OK |
| R9 | "R9: el cierre exige el único checkbox y no re-muestra secretos" | RevelarSecretosModal.test.tsx | OK |
| R10 | "R10: al cerrar, ambos secretos se descartan del DOM (solo estado local)" | RevelarSecretosModal.test.tsx | OK |
| R11 | "R11/R12: key ok pero registrarWebhook falla → revela igual el secreto de la key…" | ApiKeysModule + RevelarSecretosModal | OK |
| R12 | "R11/R12: … avisa sin internals" (asserts no `config_error`/`WEBHOOK_SECRET_ENC_KEY`) | ApiKeysModule.test.tsx | OK |
| R13 | "R13: en fallo parcial la key queda listada y reintentar es por el botón Editar" | ApiKeysModule.test.tsx | OK |
| R14 | "R14: refresca el listado antes de mostrar el revelado" | ApiKeysModule.test.tsx | OK |
| R15 | "R15: el botón de la fila se rotula 'Editar' (no 'Webhook')" | WebhookAccionCell.test.tsx | OK |
| R16 | "R16: 'Editar' abre el modal y lee el estado con obtenerWebhook" | WebhookAccionCell.test.tsx | OK |
| R17 | R3/R7b/R13/R14/R19/R20/R21 (editar URL, dar de baja, rotar) | WebhookAccionCell.test.tsx | OK |
| R18 | "R4: owner sin suscripción indica 'sin webhook' y ofrece registrar" (acción "Registrar") | WebhookAccionCell.test.tsx | OK |
| R19 | "R18: registrar 'creada' abre el revelado" / "R21: rotarSecretoWebhook ok…" | WebhookAccionCell.test.tsx | OK |
| R20 | "R3/R4/R20: URL no-https marca error accesible" (role="alert") + label asociado | GenerarApiKeyForm.test.tsx | OK |

Todos los R están cubiertos por asserts reales de comportamiento (no nombres vacíos).

## Conformidad con el gate F1.4

- [x] URL de webhook OPCIONAL; vacío → NO registra (R2 verificado: `registrarWebhook` no
  se llama). URL validada https reusando `registrarWebhookSchema` + helper compartido
  `webhook-url.ts` (`esHttpsValida`), sin duplicar reglas — consumido por ambos formularios.
- [x] Encadenado: `generarApiKey` ok → `registrarWebhook({ownerUsuarioId: keyResult.apiKey.usuarioId, url})`.
  Usa el `usuarioId` del resultado del alta (R5 verificado: `ownerUsuarioId: "u2"`).
- [x] Revelado combinado en UN modal, dos secciones (`RevelarSecretosModal`): clave siempre,
  secreto de webhook condicional; un único checkbox y un único botón "Cerrar"; cada secreto
  una sola vez; `dismissible={false}`.
- [x] Botón de fila rotulado "Editar" (siempre); dentro registra o edita según estado
  (confirmLabel "Registrar"/"Guardar URL").
- [x] Fallo parcial (CRÍTICO): key creada + `registrarWebhook` falla → se revela IGUAL el
  secreto de la key (`plainKey`), aviso neutro sin internals, key queda listada, reintento por
  "Editar". Verificado por el test R11/R12 (mock `config_error`) y R13. El secreto de la key
  nunca se pierde: el flujo pone `webhookSecret: null` pero conserva `plainKey`.
- [x] Anti-doble-submit por fase `pending` del `Modal` (R6): doble click → `generarApiKey` y
  `registrarWebhook` cada uno una sola vez.

## Seguridad / PII

- [x] Secretos (key y webhook) solo en `useState` local del componente; se descartan al cerrar
  (`setRevelado(null)` / `setSecreto(null)`). Verificado que no aparecen en DOM tras cerrar y no
  llegan a `console.*` ni a `Storage.setItem` (tests R10 y R30).
- [x] El estado del webhook por fila (`WebhookAccionCell`) es `{url, activa}` — nunca el secreto
  (verificado R5 de la 105).
- [x] Aviso de fallo parcial neutro: no expone `config_error` ni `WEBHOOK_SECRET_ENC_KEY`.

## Convenciones

- [x] Reuso de `GenerarApiKeyForm`, `RegistrarWebhookForm`, `Modal`, `FormField`, actions y
  schemas existentes. Helper `https` extraído a un único origen; `RegistrarWebhookForm` migrado
  a consumirlo sin regresión (5 tests verdes).
- [x] Modales originales de revelado por fila (`RevelarApiKeyModal`/`RevelarWebhookSecretoModal`)
  se conservan para el flujo 105; el combinado es exclusivo del alta.
- [x] Sin cambios en backend/DB.

## Verificación ejecutable

- `pnpm typecheck` → verde (sin errores).
- `pnpm lint` → 0 errores, 144 warnings preexistentes (ninguno en archivos de la feature salvo
  el `within` no usado, preexistente e irrelevante).
- Tests del módulo (4 archivos): `GenerarApiKeyForm` + `RevelarSecretosModal` + `ApiKeysModule`
  + `WebhookAccionCell` → **51/51 verdes**.
- Regresión `RegistrarWebhookForm.test.tsx` (helper extraído) → **5/5 verdes**.

## Hallazgos

- **menor** — `GenerarApiKeyForm.submit()` pasa `ownerUsuarioId: "pendiente"` como placeholder al
  `safeParse` de `registrarWebhookSchema` (la key aún no existe). Es inocuo (solo interesa la rama
  `url` y el owner real se usa en el encadenado con `keyResult.apiKey.usuarioId`), pero acopla el
  formulario a un valor mágico del schema. No bloquea.
- **menor** — CHECKPOINTS pide E2E Playwright para flujos de webhooks. Aquí no se añadió, pero la
  feature es UI pura que reusa Server Actions ya cubiertas por sus features de backend (82/104/105);
  la lógica nueva está cubierta por tests de componente con asserts de comportamiento. No bloqueante
  para una refinación de frontend.

Sin hallazgos bloqueantes.
