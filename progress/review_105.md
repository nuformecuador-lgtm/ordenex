# Review 105 — Webhooks: UI de registro (Configuración > API)

> Reviewer (read-only). Rama revisada: `feature/105-webhooks-ui-registro`
> (base `feature/99-webhooks-cambios-estado`). Spec: `origin/chore/registro-features-webhooks-103-105`.

## Checklist CHECKPOINTS

- [x] Existe requirements.md (EARS, R1..R21 + R7b).
- [x] Existe design.md con alternativas descartadas y porqué (D1/D2/D3/D4 + P4/P5).
- [~] tasks.md existe; **T1..T7 quedaron `[ ]` sin marcar** (solo T0 `[x]`) aunque el trabajo está hecho. Bookkeeping.
- [x] Cada R<n> mapea a >=1 test concreto y real (no vacío) — ver tabla.
- [x] impl_105 contiene el mapa R<n> -> test.
- [x] `pnpm typecheck` exit 0 (strict, medido en la rama).
- [x] `pnpm lint` 0 errores (144 warnings pre-existentes/ambientales).
- [x] Tests de la feature: 5 archivos, 45/45 verdes (corridos por el reviewer).
- [x] No hay tablas/RLS/migraciones nuevas (feature frontend pura) — N/A.
- [x] Sin secretos hardcodeados; el secreto vive solo en `useState` local (R17, aserción negativa a console/storage).
- [x] Server Actions para mutaciones (no fetch a rutas API). Componentes cliente no re-deciden permisos (puerta `maestro` heredada del Server Component, R1).
- [x] Sin hardcode de país/moneda/contexto.
- [x] Separación de capas respetada (UI solo compone; contrato en `lib/actions/webhooks.ts` de la 104).
- [~] `./init.sh`: lint+typecheck verdes; la suite completa es larga y bajo carga paralela dio 1 flake de timeout (`usuario-form` weak-password, 5s) + los 2 `HomePageRol` ambientales conocidos. `usuario-form` pasa 14/14 aislado → flake ambiental, ajeno a la 105.

## Trazabilidad R<n> -> test -> resultado

| R | Test | Estado |
| --- | --- | --- |
| R1  | ConfiguracionApiPage `R1 (105): rol no maestro no ve la gestión de webhooks` | OK |
| R2  | ApiKeysModule `R2 (105): cada fila expone la acción 'Webhook'` (header + botón por fila) | OK |
| R3  | WebhookAccionCell `R3: activa muestra URL y estado (vía obtenerWebhook)` | OK |
| R4  | WebhookAccionCell `R4: sin suscripción indica 'sin webhook' y ofrece registrar` | OK |
| R5  | WebhookAccionCell `R5: la lectura nunca renderiza el secreto` | OK |
| R6  | RegistrarWebhookForm `R6: no-https se bloquea en cliente, NO invoca la action` (+ variante https sí invoca) | OK |
| R7  | RevelarWebhookSecretoModal `R7: secreto en claro + aviso única vez` | OK |
| R7b | WebhookAccionCell `R7b: 'actualizada' NO abre modal de secreto; confirma y refresca` | OK |
| R8  | RevelarWebhookSecretoModal `R8: cerrar disabled sin checkbox; Escape/overlay no cierran; tras cerrar sale del DOM` | OK |
| R9  | RegistrarWebhookForm `R9: validation_error pinta fieldErrors y no cierra` | OK |
| R10 | RegistrarWebhookForm `R10: owner_invalido aviso no-campo y no cierra` | OK |
| R11 | RegistrarWebhookForm `R11: config_error mensaje neutro; sin WEBHOOK_SECRET_ENC_KEY ni 'env' en DOM` | OK |
| R12 | WebhookAccionCell `R12: forbidden mensaje claro, modal no se cierra, URL conservada` | OK |
| R13 | WebhookAccionCell `R13: baja pide confirmación antes de desactivarWebhook` | OK |
| R14 | WebhookAccionCell `R14: desactivar ok refleja 'sin webhook' sin recargar` | OK |
| R15 | WebhookAccionCell `R15: sin activa NO ofrece dar de baja` | OK |
| R16 | WebhookAccionCell `R16: registrar en curso, 2º submit no dispara 2ª llamada` (Modal pendingRef) | OK (ver M2) |
| R17 | RevelarWebhookSecretoModal `R17: mostrar→copiar→cerrar sin fuga a console/storage` | OK |
| R18 | WebhookAccionCell `R18: 'creada' abre revelado y re-lee estado` (+ R7b/R14 re-lectura) | OK |
| R19 | WebhookAccionCell `R19: 'Rotar secreto' solo con activa` | OK |
| R20 | WebhookAccionCell `R20: rotar pide confirmación advirtiendo invalidación` | OK |
| R21 | WebhookAccionCell `R21: rotarSecretoWebhook ok abre revelado con secreto NUEVO` | OK |

Sin GAPs de trazabilidad. Los 45 tests corren y pasan (verificado por el reviewer, no solo por bitácora).

## Discrepancias contrato↔spec (foco #7) — verificadas correctas

1. Union de `registrarWebhook`: el design §1 lo describía anidado (`resultado: creada|actualizada`);
   el contrato REAL de la 104 (`lib/types/webhook.ts`) discrimina por `status` directamente
   (`{status:"creada", secret}` | `{status:"actualizada"}`). El componente cablea al union real
   (`res.status === "creada"` / `"actualizada"`). Coincide con el backend verificado. NO oculta bug;
   el design autoriza ajustar el mapeo, no los requisitos.
2. https en cliente: `registrarWebhookSchema.url` solo es `min(1)`; R6 exige https. El form reusa el
   schema para la forma y añade `new URL(u).protocol === "https:"` antes de invocar la action. Es una
   validación ESTRICTA (superset): no rechaza input válido ni deja pasar input inválido → no diverge
   de forma dañina. R6 es explícitamente un bloqueo de cliente y está cubierto. (Observación O1.)

## Hallazgos

- **menor M1 (bookkeeping):** en `specs/105-webhooks-ui-registro/tasks.md` de la rama, T1..T7 siguen
  `[ ]` pese a estar hechas. CHECKPOINTS exige todas `[x]` para pasar a `done`. Corrección trivial del
  implementer (solo marcar casillas); no afecta código ni verificación.
- **menor M2 (cobertura):** el nombre de task de R16 prometía "registrar/desactivar/rotar", pero el test
  solo ejercita `registrar`. El anti-doble-submit de baja/rotar comparte el mismo mecanismo (`Modal`
  `pendingRef` + `closeOnConfirm=false`), por lo que la protección existe; falta la aserción explícita
  para las otras dos operaciones. No bloqueante.
- **O1 (observación, fuera de alcance 105):** el backend de la 104 no impone https en su borde zod
  (solo `min(1)`); el cliente es la única puerta https. Aceptable para R6 (cliente), pero conviene que
  la 104 revalide https server-side. Ajeno a esta feature.
- **O2 (observación):** import `within` sin usar en `WebhookAccionCell.test.tsx` (warning de lint, no error).

## Veredicto

**OK** — 0 bloqueantes. La UI cumple R1..R21 (+R7b): revelado del secreto una sola vez SOLO en ALTA
(`creada`) y ROTACIÓN, nunca al editar URL (`actualizada`); modal no-descartable con checkbox y borrado
del DOM al cerrar (R8/R17); lectura sin secreto (R5); errores neutros (R9–R12); anti-doble-submit (R16);
https en cliente (R6); acciones solo con suscripción activa (R15/R19). Typecheck y lint limpios; 45/45
tests verdes. Antes de marcar `done`, el implementer debe cerrar M1 (marcar tasks) — no requiere re-review.
