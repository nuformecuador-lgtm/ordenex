# Impl 105 — Webhooks: UI de registro (Configuración > API)

> Frontend puro. Rama de trabajo: `feature/105-webhooks-ui-registro` (base:
> `feature/99-webhooks-cambios-estado`, que trae el backend de la 104). Consume
> `lib/actions/webhooks.ts` sin tocar backend/DB/API.

## Archivos creados

- `app/(app)/configuracion/api/_components/RevelarWebhookSecretoModal.tsx` — modal
  de revelado del secreto UNA vez (espejo de `RevelarApiKeyModal`). Reusado por ALTA
  y rotación.
- `app/(app)/configuracion/api/_components/RegistrarWebhookForm.tsx` — form de
  registro/edición de la URL; valida `https` en cliente; traduce errores a campo /
  no-campo.
- `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx` — celda "Webhook"
  por fila; orquesta lectura (`obtenerWebhook`), registrar/editar, rotar y baja.

## Archivos modificados

- `app/(app)/configuracion/api/_components/api-keys-columns.tsx` — añade la columna
  "Webhook" que renderiza `WebhookAccionCell(ownerUsuarioId=row.usuarioId, identificador)`.
- `tests/components/ApiKeysModule.test.tsx` — mock de `@/lib/actions/webhooks` + test R2.
- `tests/components/ConfiguracionApiPage.test.tsx` — test R1.

(No se editó `ApiKeysModule.tsx` ni `page.tsx`: la columna se compone en
`buildApiKeysColumns()` y la lectura es on-demand, D2 — sin pre-carga.)

## Tests creados

- `tests/components/RevelarWebhookSecretoModal.test.tsx` (R7, R8, R17)
- `tests/components/RegistrarWebhookForm.test.tsx` (R6, R9, R10, R11)
- `tests/components/WebhookAccionCell.test.tsx` (R3, R4, R5, R7b, R12, R13, R14,
  R15, R16, R18, R19, R20, R21)

## Mapa Requisito → Test

| Req | Test |
| --- | --- |
| R1  | ConfiguracionApiPage: `R1 (105): rol no maestro no ve la gestión de webhooks` |
| R2  | ApiKeysModule: `R2 (105): cada fila de API key expone la acción 'Webhook'` |
| R3  | WebhookAccionCell: `R3: owner con suscripción activa muestra la URL y el estado activa` |
| R4  | WebhookAccionCell: `R4: owner sin suscripción indica 'sin webhook' y ofrece registrar` |
| R5  | WebhookAccionCell: `R5: la lectura del estado nunca renderiza el secreto` |
| R6  | RegistrarWebhookForm: `R6: una URL no-https se bloquea en cliente y NO invoca la Server Action` (+ variante https válida sí invoca) |
| R7  | RevelarWebhookSecretoModal: `R7: muestra el secreto en claro y el aviso de única vez` |
| R7b | WebhookAccionCell: `R7b: registrar 'actualizada' NO abre el modal de secreto; confirma y refresca` |
| R8  | RevelarWebhookSecretoModal: `R8: Cerrar deshabilitado sin checkbox; Escape/overlay no cierran; tras cerrar sale del DOM` |
| R9  | RegistrarWebhookForm: `R9: validation_error pinta fieldErrors (url) y no cierra` |
| R10 | RegistrarWebhookForm: `R10: owner_invalido muestra aviso de cuenta no válida y no cierra` |
| R11 | RegistrarWebhookForm: `R11: config_error muestra 'configuración pendiente del servidor' sin exponer internals` |
| R12 | WebhookAccionCell: `R12: forbidden muestra mensaje claro y no cierra destructivamente` |
| R13 | WebhookAccionCell: `R13: dar de baja pide confirmación antes de invocar desactivarWebhook` |
| R14 | WebhookAccionCell: `R14: desactivar ok refleja 'sin webhook activo' sin recargar la página` |
| R15 | WebhookAccionCell: `R15: sin suscripción activa NO se ofrece la acción de dar de baja` |
| R16 | WebhookAccionCell: `R16: mientras registrar está en curso, un segundo envío no dispara otra llamada` |
| R17 | RevelarWebhookSecretoModal: `R17: durante mostrar→copiar→cerrar el secreto no llega a console ni a storage` |
| R18 | WebhookAccionCell: `R18: registrar 'creada' abre el revelado y re-lee el estado` (+ R7b/R14 re-lectura) |
| R19 | WebhookAccionCell: `R19: 'Rotar secreto' solo se ofrece con suscripción activa` |
| R20 | WebhookAccionCell: `R20: rotar pide confirmación advirtiendo que invalida el secreto anterior` |
| R21 | WebhookAccionCell: `R21: rotarSecretoWebhook ok abre el revelado con el secreto NUEVO una sola vez` |

## Discrepancia contrato vs spec (resuelta, backend NO tocado)

- El union real de `registrarWebhook` discrimina por `status` directamente
  (`{status:"creada", secret}` | `{status:"actualizada"}`), NO por un campo anidado
  `resultado` como sugería el design §1. Se cableó al union real (design §1 nota:
  "si difieren, ajusta el mapeo, no los requisitos"). Igual para `rotarSecretoWebhook`
  (`{status:"ok", secret}`) y `obtenerWebhook` (`{status:"ok", webhook}`).
- `registrarWebhookSchema.url` en `lib/types/webhook.ts` solo garantiza `min(1)`, no
  `https`. R6 exige bloquear no-https en cliente. Se reusa el schema para la forma y
  se refuerza `https` en cliente (`new URL(u).protocol === "https:"`) sin modificar
  backend. El borde server revalida igualmente.

## Verificación (salidas reales)

- Tests afectados: `pnpm vitest run` sobre los 5 archivos →
  **Test Files 5 passed (5) · Tests 45 passed (45)**.
- Typecheck: `pnpm typecheck` → **exit 0, sin errores** (limpio; los 2 fallos
  ambientales `HomePageRol` no aparecieron en esta corrida).
