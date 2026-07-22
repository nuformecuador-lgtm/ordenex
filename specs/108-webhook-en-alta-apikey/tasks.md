# Feature 108 — Tasks

> Todos los tests son de componente (Testing Library) sobre el módulo/formularios de
> `Configuracion > API`. Se mockean las Server Actions (`generarApiKey`, `registrarWebhook`,
> `obtenerWebhook`, `rotarSecretoWebhook`, `desactivarWebhook`) como en los tests existentes de
> features 82/105. Sin cambios de backend → no hay tests de service ni de repositorio.

## Checklist

- [x] **T1 — Helper `https` compartido.** Extraer `esHttpsValida` de `RegistrarWebhookForm.tsx` a
  `_components/webhook-url.ts` y consumirlo desde ambos formularios (sin duplicar reglas).
  *Hecho:* un único origen del helper; `RegistrarWebhookForm` sigue verde. Depende de: —. `[P]`

- [x] **T2 — Campo opcional de URL en `GenerarApiKeyForm`.** Añadir estado + `FormField`
  ("URL de webhook (callback)", opcional); ampliar el handle `submit()` a
  `{ keyResult, webhookUrl }`; validar URL no vacía con `registrarWebhookSchema` + T1 antes de
  invocar la action. *Hecho:* cubre R1, R3, R4, R20. Depende de: T1.

- [x] **T3 — Orquestación del encadenado en `ApiKeysModule`.** `onConfirmForm` compone
  `generarApiKey` → (si `ok` y URL) `registrarWebhook`; amplía el estado `Revelado`
  (`webhookSecret`, `webhookFallo`); refresca listado antes del revelado. *Hecho:* cubre
  R2, R5, R6, R11, R12, R13, R14. Depende de: T2.

- [x] **T4 — `RevelarSecretosModal` (revelado combinado).** Componente nuevo: sección clave +
  sección webhook (condicional) o aviso de fallo; único checkbox y único cierre; `dismissible={false}`;
  secretos solo en estado local. *Hecho:* cubre R7, R8, R9, R10. Depende de: T3.

- [x] **T5 — Rótulo de fila "Editar".** Cambiar el texto del botón de `WebhookAccionCell` a
  "Editar" y su `aria-label`; verificar que el modal de gestión sigue registrando/editando/rotando/
  dando de baja sin regresión. *Hecho:* cubre R15, R16, R17, R18, R19. Depende de: —. `[P]`

- [x] **T6 — Tests de componente (trazabilidad R→test).** Escribir/actualizar los tests de la tabla
  de abajo. *Hecho:* cada R con test verde. Depende de: T2–T5.

- [x] **T7 — Verificación.** `./init.sh` en verde + suite de tests del módulo API. *Hecho:*
  typecheck + tests verdes; sin regresión en tests de features 82/105. Depende de: T6.

## Mapa R → test

| R | Test (comportamiento) | Archivo sugerido |
| --- | --- | --- |
| R1 | "muestra el campo opcional de URL de webhook en el modal de alta" | `GenerarApiKeyForm.test.tsx` |
| R2 | "con URL vacía genera la key y NO llama a registrarWebhook" | `ApiKeysModule.test.tsx` |
| R3 | "valida la URL de webhook reusando el schema https antes de enviar" | `GenerarApiKeyForm.test.tsx` |
| R4 | "con URL no-https marca error de campo y no invoca generarApiKey ni registrarWebhook" | `ApiKeysModule.test.tsx` |
| R5 | "tras ok encadena registrarWebhook con ownerUsuarioId = apiKey.usuarioId y la URL" | `ApiKeysModule.test.tsx` |
| R6 | "bloquea el segundo submit mientras corren las dos acciones encadenadas" | `ApiKeysModule.test.tsx` |
| R7 | "sin webhook, revela solo el secreto de la key una vez" | `ApiKeysModule.test.tsx` |
| R8 | "con webhook creado, revela clave y secreto de webhook en un solo modal" | `RevelarSecretosModal.test.tsx` |
| R9 | "el cierre del revelado combinado exige el checkbox y no re-muestra secretos" | `RevelarSecretosModal.test.tsx` |
| R10 | "los secretos revelados no se persisten (solo estado local; se descartan al cerrar)" | `RevelarSecretosModal.test.tsx` |
| R11 | "key ok pero registrarWebhook falla → revela igual el secreto de la key" | `ApiKeysModule.test.tsx` |
| R12 | "en fallo parcial avisa que el webhook no se registró, sin internals" | `ApiKeysModule.test.tsx` |
| R13 | "en fallo parcial la key queda listada y reintentar el webhook es por el botón Editar" | `ApiKeysModule.test.tsx` |
| R14 | "refresca el listado antes de mostrar el revelado" | `ApiKeysModule.test.tsx` |
| R15 | "el botón de la fila se rotula Editar (no Webhook)" | `WebhookAccionCell.test.tsx` |
| R16 | "Editar abre el modal y lee el estado con obtenerWebhook" | `WebhookAccionCell.test.tsx` |
| R17 | "con suscripción activa permite editar URL, rotar y dar de baja" | `WebhookAccionCell.test.tsx` |
| R18 | "sin suscripción, permite registrar desde el modal y la acción dice Registrar" | `WebhookAccionCell.test.tsx` |
| R19 | "revela el secreto del webhook una vez al crear o rotar (sin regresión)" | `WebhookAccionCell.test.tsx` |
| R20 | "el campo de URL tiene label accesible y anuncia sus errores" | `GenerarApiKeyForm.test.tsx` |

## Notas de trazabilidad

- Ningún R depende de código de backend nuevo: todos se verifican mockeando las acciones existentes.
- R11–R13 (fallo parcial) se testean disparando cada `status` de error de `registrarWebhook`
  (`forbidden`, `config_error`, `owner_invalido`, `validation_error`) tras un `generarApiKey` `ok`.
- Si el gate F1.4 cambia la decisión (b) a "revelado en pasos" o (c) a "rótulo condicional",
  se ajustan T4/T5 y las filas R8/R9/R15/R18 de esta tabla.
