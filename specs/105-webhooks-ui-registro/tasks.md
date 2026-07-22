# Feature 105 — Tasks: Webhooks UI de registro (Configuración > API)

> Frontend puro. Rama base: `feature/99-webhooks-cambios-estado` (NO `dev`), porque el
> backend de la 104 aún no está en `dev`. Rama de trabajo: `feature/105-webhooks-ui-registro`.
> Escribir en LF. Cada task tiene criterio de "hecho". `[P]` = paralelizable.
>
> Tests: patrón de `tests/components/ApiKeysModule.test.tsx` (módulo cliente, mockeando las
> Server Actions) y `tests/components/ConfiguracionApiPage.test.tsx` (Server Component real,
> mockeando resolver + actions + service). Cada `R<n>` mapea a un test nombrado abajo.

## Gate previo (CERRADO)

- [x] **T0 — Gate F1.4 resuelto.** Decisiones FIJAS (ver "Resolución del gate F1.4" en
      `requirements.md` y §6 de `design.md`): D1 acción por fila (APROBADA); D2 Server Action
      de lectura `obtenerWebhook` (APROBADA, sin variante degradada); D3 mensaje neutro
      (APROBADA); P4 editar NO rota, rotación explícita vía `rotarSecretoWebhook` (CAMBIO);
      P5 validación reusa `registrarWebhookSchema` (https).

## Verificación del contrato (lectura, no escritura)

- [ ] **T1 — Verificar el contrato de la 104.** Leer con `git show` en la rama base:
      `lib/actions/webhooks.ts`, `lib/types/webhook.ts`, `IWebhookSuscripcionService.ts`.
      Anotar nombres exactos: `registrarWebhook` (`resultado: "creada"|"actualizada"`,
      `secret` solo en `creada`), `rotarSecretoWebhook` (`secret`), `obtenerWebhook`
      (`webhook: {url,activa}|null`), `desactivarWebhook`, y campos de `fieldErrors`
      (`url`/`ownerUsuarioId`). **Hecho:** mapeo de estados→UI confirmado; discrepancias
      frente al design anotadas.
      *Depende de: T0.*

## Componentes (implementación + tests)

- [ ] **T2 [P] — `RevelarWebhookSecretoModal.tsx`** (espejo de `RevelarApiKeyModal`).
      Muestra `secret` en `font-mono`, aviso "única vez" `role="alert"`, Copiar con fallback
      de clipboard, checkbox obligatorio → único cierre, `dismissible={false}`.
      Reutilizable por ALTA (R7) y rotación (R21). **Hecho:** componente creado; tests en
      verde. → **R7, R8, R17**
      Tests (`tests/components/RevelarWebhookSecretoModal.test.tsx`):
      - `R7: muestra el secreto en claro y el aviso de única vez`
      - `R8: Cerrar deshabilitado sin checkbox; Escape/overlay no cierran; tras cerrar el secreto sale del DOM`
      - `R17: durante mostrar→copiar→cerrar el secreto no llega a console ni a storage`
      *Depende de: T1.*

- [ ] **T3 [P] — `RegistrarWebhookForm.tsx`** (molde de `GenerarApiKeyForm`). Campo `url`,
      validación cliente con `registrarWebhookSchema`, handle `submit()`, pinta
      `fieldErrors`, traduce `owner_invalido` y `config_error` a avisos no-campo.
      **Hecho:** componente creado; tests en verde. → **R6, R9, R10, R11**
      Tests (`tests/components/RegistrarWebhookForm.test.tsx`):
      - `R6: una URL no-https se bloquea en cliente y NO invoca la Server Action`
      - `R9: validation_error pinta fieldErrors (url/ownerUsuarioId) y no cierra`
      - `R10: owner_invalido muestra aviso de cuenta no válida y no cierra`
      - `R11: config_error muestra "configuración pendiente del servidor" sin exponer internals`
      *Depende de: T1.*

- [ ] **T4 — `WebhookAccionCell.tsx`** (dueño de los modales por fila). Botón "Webhook" que
      abre el modal de gestión; al abrir y tras cada mutación lee el estado con
      `obtenerWebhook` (D2); muestra estado (activa/sin registrar); orquesta: registrar/editar
      (abre `RevelarWebhookSecretoModal` solo si `resultado: "creada"`, R7/R7b), **"Rotar
      secreto"** con confirmación (R19–R21) y dar de baja con confirmación; anti-doble-submit;
      refresco del owner tras `ok`.
      **Hecho:** componente creado; tests en verde.
      → **R3, R4, R5, R7b, R12, R13, R14, R15, R16, R18, R19, R20, R21**
      Tests (`tests/components/WebhookAccionCell.test.tsx`):
      - `R3: owner con suscripción activa muestra la URL y el estado activa (vía obtenerWebhook)`
      - `R4: owner sin suscripción indica "sin webhook" y ofrece registrar`
      - `R5: la lectura del estado (obtenerWebhook) nunca renderiza el secreto`
      - `R7b: registrar con resultado "actualizada" NO abre el modal de secreto; confirma y refresca`
      - `R12: forbidden/unauthenticated muestran mensaje claro y no cierran destructivamente`
      - `R13: dar de baja pide confirmación antes de invocar desactivarWebhook`
      - `R14: desactivar ok refleja "sin webhook activo" sin recargar la página`
      - `R15: sin suscripción activa NO se ofrece la acción de dar de baja`
      - `R16: mientras registrar/desactivar/rotar está en curso, un segundo envío no dispara otra llamada`
      - `R18: registrar/desactivar/rotar ok refresca el estado del owner (re-lee obtenerWebhook)`
      - `R19: "Rotar secreto" solo se ofrece con suscripción activa`
      - `R20: rotar pide confirmación advirtiendo que invalida el secreto anterior`
      - `R21: rotarSecretoWebhook ok abre el revelado con el secreto NUEVO una sola vez`
      *Depende de: T2, T3.*

## Integración en la tabla y la página

- [ ] **T5 — Columna "Webhook" en `api-keys-columns.tsx` + `ApiKeysModule.tsx`.** Añadir la
      columna que renderiza `WebhookAccionCell` (recibe `ownerUsuarioId` e `identificador` de
      la fila; el estado NO viaja en la fila — la celda lo lee con `obtenerWebhook`, D2). No
      se toca la paginación por SWR de la 82. **Hecho:** columna presente; sin regresión de
      las columnas de la feature 82. → **R2**
      Tests (extender `tests/components/ApiKeysModule.test.tsx`):
      - `R2: cada fila de API key expone la acción "Webhook"`
      *Depende de: T4.*

- [ ] **T6 — Puerta `maestro` en `page.tsx` (verificación, sin cambios de pre-carga).** La
      gestión de webhooks vive dentro de la página ya gateada a `maestro` (feature 82/R11);
      NO se pre-carga estado de webhook (lectura on-demand, D2). **Hecho:** confirmado que el
      rol no maestro no ve la columna/acción; test en verde. → **R1**
      Tests (extender `tests/components/ConfiguracionApiPage.test.tsx`):
      - `R1: rol no maestro no ve la gestión de webhooks`
      *Depende de: T5.*

## Cierre

- [ ] **T7 — Trazabilidad y verificación.** Rellenar `progress/impl_105-webhooks-ui-registro.md`
      con el mapa `R1..R21 → test`. Correr `./init.sh` y la suite; typecheck limpio (medir el
      baseline en la rama base antes de afirmar verde — la bitácora caduca).
      **Hecho:** `./init.sh` verde, todos los tests de R1..R21 (incl. R7b) pasan, cada `R<n>`
      mapeado.
      *Depende de: T2–T6.*

## Mapa Requisito → Test (resumen)

| Req | Test |
| --- | --- |
| R1  | ConfiguracionApiPage: `R1: rol no maestro no ve la gestión de webhooks` |
| R2  | ApiKeysModule: `R2: cada fila de API key expone la acción "Webhook"` |
| R3  | WebhookAccionCell: `R3: owner con suscripción activa muestra la URL y el estado activa (vía obtenerWebhook)` |
| R4  | WebhookAccionCell: `R4: owner sin suscripción indica "sin webhook" y ofrece registrar` |
| R5  | WebhookAccionCell: `R5: la lectura del estado (obtenerWebhook) nunca renderiza el secreto` |
| R6  | RegistrarWebhookForm: `R6: una URL no-https se bloquea en cliente…` |
| R7  | RevelarWebhookSecretoModal: `R7: muestra el secreto en claro y el aviso de única vez` |
| R7b | WebhookAccionCell: `R7b: registrar "actualizada" NO abre el modal de secreto; confirma y refresca` |
| R8  | RevelarWebhookSecretoModal: `R8: Cerrar deshabilitado sin checkbox; Escape/overlay…` |
| R9  | RegistrarWebhookForm: `R9: validation_error pinta fieldErrors…` |
| R10 | RegistrarWebhookForm: `R10: owner_invalido muestra aviso…` |
| R11 | RegistrarWebhookForm: `R11: config_error muestra "configuración pendiente…"` |
| R12 | WebhookAccionCell: `R12: forbidden/unauthenticated muestran mensaje claro…` |
| R13 | WebhookAccionCell: `R13: dar de baja pide confirmación…` |
| R14 | WebhookAccionCell: `R14: desactivar ok refleja "sin webhook activo"…` |
| R15 | WebhookAccionCell: `R15: sin suscripción activa NO se ofrece dar de baja` |
| R16 | WebhookAccionCell: `R16: mientras la operación está en curso, un segundo envío…` |
| R17 | RevelarWebhookSecretoModal: `R17: el secreto no llega a console ni a storage` |
| R18 | WebhookAccionCell: `R18: registrar/desactivar/rotar ok refresca el estado del owner` |
| R19 | WebhookAccionCell: `R19: "Rotar secreto" solo se ofrece con suscripción activa` |
| R20 | WebhookAccionCell: `R20: rotar pide confirmación advirtiendo que invalida el secreto anterior` |
| R21 | WebhookAccionCell: `R21: rotarSecretoWebhook ok abre el revelado con el secreto NUEVO una vez` |
</content>
