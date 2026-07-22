# Review — Feature 104 (webhooks) · DELTA gate P4/D2

Rama `feature/99-webhooks-cambios-estado` · commit delta `166d294` (padre `a837c2b`).
Re-revisión tras cambio de contrato aprobado (result `ok` → `creada`/`actualizada` +
rotación explícita + lectura para UI). Verificado en read-only vía `git show`/`git diff` y
ejecutando los tests en un **worktree detached** sobre `166d294` (sin switch de rama).

## Checklist

- [x] Trazabilidad R33–R35 → tests reales (no vacíos). Ver tabla.
- [x] Editar conserva el secreto (no lo regenera ni lo devuelve); ALTA lo genera+devuelve una vez.
- [x] Reactivación al re-registrar una suscripción de baja (conserva secreto, `activa=true`).
- [x] `rotarSecreto`: secreto NUEVO distinto, cifrado, invalida el anterior, `not_found` sin suscripción, nunca loguea.
- [x] `obtenerWebhook`: nunca expone el secreto (ni cifrado); autz `maestro`; `config_error` no aplica (no cifra) — coherente.
- [x] Aislamiento R9: todo keyed por `ownerUsuarioId`; guard `ownerEsApiKey` intacto en `registrar`.
- [x] Sin regresión: emisión/outbox/handler/sender/firma/cipher/migraciones NO tocados (diff `--stat` del delta lo confirma).
- [x] Tests que asumían "editar rota" actualizados correctamente (aserciones más estrictas, no relajadas).
- [x] Capas: controller sin Prisma (solo schemas/service/repo builders); service sin Next; repo solo queries.
- [x] Tests ejecutados por el reviewer (worktree): 37 del delta + 49 de regresión webhook = **86 passed, 0 failed**.
- [x] Typecheck `tsc --noEmit` **verde** tras generar el client desde el schema de la rama (los errores iniciales eran staleness del client compartido de `dev`, que no tiene el modelo `WebhookSuscripcion`).

## Tabla R → test (verificada)

| R | Test que lo verifica | Estado |
| --- | --- | --- |
| R33 alta `creada` | service: "el alta retorna el secreto en claro (status creada)…"; action: "un maestro da de alta y recibe el secreto una vez (creada)" | PASS |
| R33 edición `actualizada` (conserva secreto, sin devolverlo) | service: "editar un owner existente actualiza la URL, conserva el secreto y NO devuelve secreto"; action: "R33: editar la URL … devuelve actualizada, sin secreto" | PASS |
| R33 reactivación de baja | service: "editar una suscripción dada de baja la reactiva conservando el secreto" | PASS |
| R34 rotación (nuevo distinto, cifra, invalida) | service: "rotar genera un secreto NUEVO distinto…"; action: "un maestro rota y recibe el nuevo secreto una vez" | PASS |
| R34 `not_found` sin suscripción | service: "rotar sin suscripción devuelve not_found y no persiste nada"; action: "sin suscripción -> not_found" | PASS |
| R34 config_error | action: "R32: si falta la clave de cifrado -> config_error (no propaga la excepcion)" | PASS |
| R35 vista sin secreto | action: "R35: devuelve la vista {url, activa} y NUNCA el secreto"; "sin suscripción devuelve webhook null" | PASS |
| R7 (no fuga tras rotar) | service: "R7: la vista de consulta tras rotar sigue sin exponer el secreto" | PASS |
| R9 aislamiento repo | repo: "actualizarUrlByOwner … (R9)"; "actualizarSecretoByOwner … (R9)" | PASS |
| Autz maestro (rotar/obtener) | action: bloques unauthenticated/forbidden/validation_error | PASS |

## Hallazgos

- **menor.** No se pudo ejecutar `./init.sh` completo ni la suite global con el setup
  `jest-dom` por un árbol de `node_modules` incompleto en el entorno (`@adobe/css-tools`
  ausente — issue conocido de pnpm, ajeno al delta). Se ejecutaron los tests backend
  relevantes con setup mínimo; todos verdes. Los 2 fallos `HomePageRol` son
  pre-existentes/ambientales (fuera del alcance del delta).
- **menor.** El typecheck sobre el client compartido de `dev` reporta falsos positivos
  (`webhookSuscripcion`/`webhook_estado` ausentes) porque el schema de `dev` aún no
  incorpora el modelo; al generar el client desde `db/schema.prisma` de la rama, `tsc`
  queda limpio. No es defecto del delta. El client de `dev` fue restaurado tras verificar.

Sin hallazgos BLOQUEANTES.

## Veredicto

**OK** — El delta cumple el contrato del gate P4/D2: editar solo actualiza la URL
conservando el secreto (`actualizada`), el alta y la rotación devuelven el secreto en claro
exactamente una vez (`creada`/`ok`), `obtenerWebhook` nunca expone el secreto, aislamiento
R9 y guard `ownerEsApiKey` intactos, y no hay regresión sobre emisión/handler/firma/
migraciones. R33–R35 mapeados a tests reales que pasan.
