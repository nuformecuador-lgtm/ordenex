# Impl 108 — Registrar webhook en el alta de la API key + botón de fila "Editar"

Zona: **frontend**. Sin cambios de backend, DB ni Server Actions. Gate F1.4 aprobado
respetado (URL opcional, revelado combinado en un modal, botón fijo "Editar", fallo
parcial revela igual la key, anti-doble-submit por fase `pending`).

## Estado

Todas las tareas T1–T7 completadas (`tasks.md` marcado `[x]`).

## Archivos tocados / creados

### Creados
- `app/(app)/configuracion/api/_components/webhook-url.ts` — T1: helper `esHttpsValida`
  compartido (único origen del refuerzo `https`).
- `app/(app)/configuracion/api/_components/RevelarSecretosModal.tsx` — T4: revelado
  combinado (sección clave + sección webhook condicional o aviso de fallo parcial;
  único checkbox y único cierre; `dismissible={false}`; secretos solo en estado local).
- `tests/components/GenerarApiKeyForm.test.tsx` — R1, R3, R4, R20.
- `tests/components/RevelarSecretosModal.test.tsx` — R8, R9, R10 (+ fallo parcial R11/R12).

### Modificados
- `app/(app)/configuracion/api/_components/RegistrarWebhookForm.tsx` — consume el helper
  `esHttpsValida` de `webhook-url.ts` (elimina la copia local; sin duplicar reglas).
- `app/(app)/configuracion/api/_components/GenerarApiKeyForm.tsx` — T2: campo opcional
  "URL de webhook (callback)"; `submit()` ahora devuelve `{ keyResult, webhookUrl }`;
  valida la URL no vacía con `registrarWebhookSchema` + `esHttpsValida` antes de invocar
  `generarApiKey` (R4: URL inválida ⇒ no se crea la key).
- `app/(app)/configuracion/api/_components/ApiKeysModule.tsx` — T3: `onConfirmForm`
  orquesta `generarApiKey` → (si `ok` y URL) `registrarWebhook({ ownerUsuarioId:
  apiKey.usuarioId, url })`; estado `Revelado` ampliado (`webhookSecret`, `webhookFallo`);
  `mutate()` antes del revelado; fallo parcial revela la key + aviso neutro + toast;
  usa `RevelarSecretosModal`.
- `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx` — T5: botón rotulado
  "Editar"; `aria-label` = "Editar webhook de {identificador}".
- `tests/components/ApiKeysModule.test.tsx` — R20 (2 campos), R2 (aria "Editar") y
  labels del revelado combinado actualizados; nuevo bloque feature 108 (R2, R4, R5, R6,
  R7, R8, R11/R12, R13, R14).
- `tests/components/WebhookAccionCell.test.tsx` — helper `abrir` usa el nuevo aria-label;
  nuevo bloque R15/R16 (rótulo "Editar").
- `specs/108-webhook-en-alta-apikey/tasks.md` — checklist marcado.

## Mapa R → test (nombres reales)

| R | Archivo | Caso |
| --- | --- | --- |
| R1  | GenerarApiKeyForm.test.tsx | "R1/R20: muestra el campo opcional de URL de webhook con label accesible" |
| R2  | ApiKeysModule.test.tsx | "R2: con URL vacía genera la key y NO llama a registrarWebhook" |
| R3  | GenerarApiKeyForm.test.tsx | "R3: con URL vacía valida solo el identificador…" / "R3: propaga la URL https válida…" |
| R4  | ApiKeysModule.test.tsx / GenerarApiKeyForm.test.tsx | "R4: con URL no-https marca error de campo y no invoca generarApiKey ni registrarWebhook" / "R3/R4/R20: URL no-https marca error accesible…" |
| R5  | ApiKeysModule.test.tsx | "R5: tras ok encadena registrarWebhook con ownerUsuarioId = apiKey.usuarioId y la URL" |
| R6  | ApiKeysModule.test.tsx | "R6: bloquea el segundo submit mientras corren las dos acciones encadenadas" |
| R7  | ApiKeysModule.test.tsx | "R7: sin webhook, revela solo el secreto de la key una vez" |
| R8  | RevelarSecretosModal.test.tsx (+ ApiKeysModule) | "R8: con webhook creado revela clave y secreto de webhook en un solo modal" |
| R9  | RevelarSecretosModal.test.tsx | "R9: el cierre exige el único checkbox y no re-muestra secretos" |
| R10 | RevelarSecretosModal.test.tsx | "R10: al cerrar, ambos secretos se descartan del DOM (solo estado local)" |
| R11 | ApiKeysModule.test.tsx (+ RevelarSecretosModal) | "R11/R12: key ok pero registrarWebhook falla → revela igual el secreto de la key…" |
| R12 | ApiKeysModule.test.tsx | "R11/R12: … y avisa sin internals" (asserts no `config_error`/`WEBHOOK_SECRET_ENC_KEY`) |
| R13 | ApiKeysModule.test.tsx | "R13: en fallo parcial la key queda listada y reintentar el webhook es por el botón Editar" |
| R14 | ApiKeysModule.test.tsx | "R14: refresca el listado antes de mostrar el revelado" |
| R15 | WebhookAccionCell.test.tsx | "R15: el botón de la fila se rotula 'Editar' (no 'Webhook')" |
| R16 | WebhookAccionCell.test.tsx | "R16: 'Editar' abre el modal y lee el estado con obtenerWebhook" |
| R17 | WebhookAccionCell.test.tsx | (sin regresión) R3/R7b/R13/R19/R21 existentes (editar/rotar/baja) |
| R18 | WebhookAccionCell.test.tsx | "R4: owner sin suscripción indica 'sin webhook' y ofrece registrar" (acción "Registrar") |
| R19 | WebhookAccionCell.test.tsx | "R18: registrar 'creada' abre el revelado…" / "R21: rotarSecretoWebhook ok…" |
| R20 | GenerarApiKeyForm.test.tsx | "R3/R4/R20: URL no-https marca error accesible" (role="alert") |

## Verificación

- `pnpm typecheck` → **verde** (baseline previo también verde).
- `pnpm lint` → **0 errores** (144 warnings preexistentes; ninguno nuevo bloqueante).
- `pnpm test` (suite completa) → **427 archivos / 4212 tests, todos verdes**.
  Sin flaky: los tests de UI conocidos (HomePage, etc.) pasaron en la corrida completa.
- Archivos de test del módulo API en aislado: 6 archivos / 59 tests verdes.

## Desvíos del spec

Ninguno. Se siguieron las decisiones del gate F1.4 al pie.
