# impl_104-delta — Webhooks: editar preserva secreto + rotación explícita + obtenerWebhook

Delta del gate **F1.4 (P4/D2)** sobre la feature 104 (webhooks, slug rama
`feature/99-webhooks-cambios-estado`). NO es feature nueva: cambios de contrato sobre lo ya
implementado en `impl_99.md`. Backend puro.

## Decisiones implementadas (gate)

1. **Editar la URL NO rota el secreto (P4).** `registrar` distingue ALTA vs EDICIÓN. Alta
   (owner sin suscripción): genera+cifra secreto y lo devuelve una vez → `{status:"creada",
   secret}`. Edición (owner con suscripción): solo actualiza la URL, conserva el secreto →
   `{status:"actualizada"}` (sin secreto).
2. **Rotación explícita (P4).** Nuevo `service.rotarSecreto(owner)` (genera+cifra secreto
   nuevo, invalida el anterior, lo devuelve una vez; `not_found` si no hay suscripción) y
   Server Action `rotarSecretoWebhook({ownerUsuarioId})` (rol maestro; forbidden/
   unauthenticated/validation_error/not_found/config_error).
3. **Lectura para la UI (D2).** Server Action `obtenerWebhook({ownerUsuarioId})` (rol
   maestro) → `{status:"ok", webhook:{url,activa}|null}`. Nunca el secreto.
4. **Aislamiento (R9):** todo keyed por `ownerUsuarioId`; guard `owner es rol apiKey` en
   `registrar` intacto.

## Archivos modificados

**Código**
- `lib/types/webhook.ts` — `RegistrarWebhookActionResult` ahora `creada`/`actualizada` (antes
  `ok`); nuevos `RotarSecretoWebhookActionResult`, `ObtenerWebhookActionResult`; schemas
  `rotarSecretoWebhookSchema`, `obtenerWebhookSchema`.
- `lib/interfaces/services/IWebhookSuscripcionService.ts` — `RegistrarWebhookResult`
  (`creada`/`actualizada`), nuevo `RotarSecretoResult`, método `rotarSecreto`.
- `lib/services/WebhookSuscripcionService.ts` — `registrar` bifurca por `findByOwner` (alta
  vs edición); nuevo `rotarSecreto`.
- `lib/interfaces/repositories/IWebhookSuscripcionRepository.ts` +
  `lib/repositories/WebhookSuscripcionRepository.ts` — nuevos `actualizarUrlByOwner` (solo
  url + reactiva, conserva secreto) y `actualizarSecretoByOwner` (solo secret).
- `lib/actions/webhooks.ts` — `registrarWebhook` (docstring/estados), nuevas
  `rotarSecretoWebhook` y `obtenerWebhook`.

**Tests**
- `tests/unit/services/webhook-suscripcion-service.test.ts` — fake repo con nuevos métodos;
  alta `creada`; edición `actualizada` (secreto intacto, incl. reactivar baja); rotación
  (nuevo distinto / not_found / vista sin secreto).
- `tests/unit/actions/webhooks-action.test.ts` — alta `creada`, edición `actualizada`;
  bloques nuevos `rotarSecretoWebhook` (autz + ok/not_found/config_error) y `obtenerWebhook`
  (autz + vista sin secreto / null).
- `tests/integration/repositories/webhook-suscripcion-repository.test.ts` — tests de
  `actualizarUrlByOwner` (conserva secreto, reactiva, no-op, R9) y `actualizarSecretoByOwner`.

**Spec** (traídos a la rama desde `chore/registro-features-webhooks-103-105` y actualizados)
- `specs/104-webhooks-cambios-estado/requirements.md` — R6/R7/R9 reescritos; nuevos R33
  (editar preserva secreto), R34 (rotación), R35 (obtener); tabla + total (32→35) + nota delta.
- `specs/104-webhooks-cambios-estado/design.md` §9 — las 4 Server Actions + §9.1 métodos repo.
- `specs/104-webhooks-cambios-estado/tasks.md` — T9/T10 reescritos y marcados [x].

## Mapa R → test (delta)

| R | Test |
| --- | --- |
| R33 (editar preserva secreto) | `webhook-suscripcion-service.test.ts` — "editar un owner existente actualiza la URL, conserva el secreto y NO devuelve secreto (actualizada)"; "editar una suscripción dada de baja la reactiva conservando el secreto"; `webhooks-action.test.ts` — "R33: editar la URL … devuelve actualizada, sin secreto" |
| R33 (alta creada) | `webhook-suscripcion-service.test.ts` — "el alta retorna el secreto en claro (status creada)…"; `webhooks-action.test.ts` — "un maestro da de alta y recibe el secreto una vez (creada)" |
| R34 (rotación) | `webhook-suscripcion-service.test.ts` — "rotar genera un secreto NUEVO distinto…"; "rotar sin suscripción devuelve not_found…"; `webhooks-action.test.ts` — bloque "rotarSecretoWebhook" (autz, ok, not_found, config_error) |
| R35 (obtener) | `webhooks-action.test.ts` — bloque "obtenerWebhook" ("R35: devuelve la vista {url, activa} y NUNCA el secreto"; null); `webhook-suscripcion-service.test.ts` — "R7: la vista de consulta tras rotar sigue sin exponer el secreto" |
| Repo (R33/R34 queries) | `webhook-suscripcion-repository.test.ts` — "actualizarUrlByOwner conserva el secreto"; "actualizarSecretoByOwner rota solo el secreto" |

## Verificación (medida en la rama)

- `pnpm typecheck` → **verde** (`tsc --noEmit`, sin errores).
- `pnpm lint` → **0 errores** (143 warnings pre-existentes, ninguno en archivos tocados).
- Tests de suscripción/acciones/repo afectados: **37 passed** (era 17 en baseline).
- Resto de la suite webhook (handler, encolado, enqueue, cron, config, firma, cipher):
  **42 passed**.

## Veredicto

Contratos nuevos verdes y sin fugas de secreto: editar solo actualiza URL (`actualizada`),
alta/rotación devuelven secreto una vez (`creada`/`ok`), `obtenerWebhook` nunca expone el
secreto. Listo para la UI (feature 105).
