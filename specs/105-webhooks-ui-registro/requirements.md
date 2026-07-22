# Feature 105 — Webhooks: UI de registro de la suscripción (Configuración > API)

> Requisitos en notación EARS. Frontend puro (zona `frontend`). NO toca backend:
> consume el contrato YA existente de la feature 104 (`lib/actions/webhooks.ts` +
> `IWebhookSuscripcionService.obtener`), que vive en la rama
> `feature/99-webhooks-cambios-estado`. Rama base de implementación: esa, no `dev`.
>
> Cada `R<n>` es testeable y queda mapeado a un test concreto en `tasks.md`.

## Contexto

La pantalla `Configuración > API` (feature 82) ya lista las API keys (owners de rol
`apiKey`) y las gestiona (generar, revelar secreto una vez). Esta feature añade, sobre
esa misma pantalla, la gestión de la **suscripción webhook** de cada owner: ver estado,
registrar/editar la URL de callback y dar de baja. Solo el rol `maestro` opera aquí.

## Requisitos

### Control de acceso

- **R1** — MIENTRAS el actor autenticado no sea rol `maestro`, el sistema NO DEBE
  renderizar ni permitir operar ninguna acción de gestión de webhooks (hereda la puerta
  server-side de `Configuración > API`, feature 82/R11).

### Lectura / visualización del estado

- **R2** — DONDE se muestra una fila de API key (un owner de rol `apiKey`) en la tabla de
  `Configuración > API`, el sistema DEBE ofrecer una acción "Webhook" para ese owner que
  permita ver, registrar/editar y dar de baja su URL de callback.
- **R3** — CUANDO el maestro abre la acción "Webhook" de un owner con suscripción activa,
  el sistema DEBE mostrar la URL de callback registrada y su estado (activa).
- **R4** — CUANDO el maestro abre la acción "Webhook" de un owner sin suscripción, el
  sistema DEBE indicar que no hay webhook registrado y ofrecer registrarlo.
- **R5** — El sistema NUNCA DEBE mostrar el secreto del webhook al leer o mostrar el
  estado (el contrato `obtener` no expone el secreto; la lectura solo entrega `url` y
  `activa`).

### Registrar / editar la URL de callback

- **R6** — CUANDO el maestro envía una URL de callback para registrar o editar, SI la URL
  no es una URL `https` válida, ENTONCES el sistema DEBE bloquear el envío en el cliente y
  mostrar un error de validación bajo el campo, sin invocar la Server Action. La validación
  de cliente reusa `registrarWebhookSchema` de `lib/types/webhook.ts` (no inventa reglas).
- **R7** — CUANDO `registrarWebhook` devuelve `status: "ok"` con resultado `creada` (ALTA:
  primer registro de la suscripción del owner), el sistema DEBE mostrar el secreto en claro
  UNA sola vez en un modal, con un aviso explícito de que no se volverá a mostrar (patrón de
  `RevelarApiKeyModal`).
- **R7b** — CUANDO `registrarWebhook` devuelve `status: "ok"` con resultado `actualizada`
  (solo se editó la URL de una suscripción existente), el sistema NO DEBE mostrar ningún
  secreto (editar la URL NO rota el secreto); DEBE confirmar la actualización y refrescar el
  estado del owner.
- **R8** — MIENTRAS el modal del secreto está abierto, el sistema DEBE impedir el cierre
  accidental (Escape y click en overlay deshabilitados) y requerir confirmación explícita
  (checkbox "Ya guardé el secreto…") para habilitar el único botón de cierre; tras cerrar,
  el secreto DEBE desaparecer del DOM y no DEBE existir acción alguna para recuperarlo.
- **R9** — CUANDO `registrarWebhook` devuelve `status: "validation_error"`, el sistema DEBE
  mostrar los `fieldErrors` (`url` y/o `ownerUsuarioId`) bajo el campo correspondiente y NO
  DEBE cerrar el formulario.
- **R10** — CUANDO `registrarWebhook` devuelve `status: "owner_invalido"`, el sistema DEBE
  informar que el owner no es una cuenta de API válida y NO DEBE cerrar el formulario.
- **R11** — CUANDO `registrarWebhook` devuelve `status: "config_error"`, el sistema DEBE
  informar que la configuración del servidor está pendiente (falta la clave de cifrado del
  webhook) y que la operación no puede completarse en este momento, sin exponer detalles
  técnicos sensibles (nombres de variables de entorno, trazas).
- **R12** — CUANDO `registrarWebhook` o `desactivarWebhook` devuelve `status: "forbidden"`
  o `status: "unauthenticated"`, el sistema DEBE mostrar un mensaje claro (sin permiso /
  sesión expirada) y NO DEBE cerrar el modal de forma que se pierda lo ingresado.

### Rotar el secreto (acción explícita)

- **R19** — MIENTRAS un owner tiene una suscripción activa, el sistema DEBE ofrecer en el
  modal de gestión una acción "Rotar secreto"; MIENTRAS no la tiene, NO DEBE ofrecerla.
- **R20** — CUANDO el maestro pulsa "Rotar secreto", el sistema DEBE pedir confirmación
  explícita advirtiendo que la rotación invalida el secreto anterior, antes de invocar
  `rotarSecretoWebhook`.
- **R21** — CUANDO `rotarSecretoWebhook` devuelve `status: "ok"`, el sistema DEBE mostrar el
  secreto NUEVO en claro UNA sola vez en el modal de revelado (patrón de `RevelarApiKeyModal`,
  mismas garantías que R8), y no DEBE volver a mostrarlo.

### Dar de baja

- **R13** — CUANDO el maestro solicita dar de baja el webhook de un owner con suscripción,
  el sistema DEBE pedir confirmación explícita antes de invocar `desactivarWebhook`.
- **R14** — CUANDO `desactivarWebhook` devuelve `status: "ok"`, el sistema DEBE reflejar el
  nuevo estado (sin webhook activo) del owner afectado sin recargar toda la página.
- **R15** — MIENTRAS un owner no tiene suscripción activa, el sistema NO DEBE ofrecer la
  acción de dar de baja (solo la de registrar).

### Robustez y seguridad de la UI

- **R16** — MIENTRAS una operación `registrarWebhook` o `desactivarWebhook` está en curso,
  el sistema NO DEBE permitir disparar una segunda llamada de la misma operación
  (anti-doble-submit).
- **R17** — El sistema NUNCA DEBE escribir el secreto del webhook en `console`, en la URL,
  en `storage` ni en el listado/tabla; el secreto vive solo en estado local del componente
  hasta que el modal se cierra.
- **R18** — CUANDO una operación (`registrarWebhook` o `desactivarWebhook`) devuelve `ok`,
  el sistema DEBE refrescar el estado del webhook del owner afectado (R3/R4/R14).

## Resolución del gate F1.4 (decisiones FIJAS)

El humano cerró el gate. Decisiones firmes (detalle técnico en `design.md`):

- **D1 (ubicación) — APROBADA.** Acción "Webhook" **por fila** en la tabla de API keys
  (`api-keys-columns`), que abre un modal de gestión. Sin sección/tab aparte.
- **D2 (lectura de estado) — APROBADA con añadido backend.** El backend de la 104 expone la
  Server Action **`obtenerWebhook({ ownerUsuarioId }) → { status: "ok"; webhook: { url, activa } | null }`**
  (NUNCA el secreto). La UI la invoca al abrir el modal y tras cada mutación (R18) para
  pintar el estado en TODAS las páginas, incluidas las paginadas por el cliente. Deja de
  existir el "hueco/degradado" de páginas > 1.
- **D3 (`config_error`) — APROBADA.** Mensaje neutro de "configuración del servidor
  pendiente", sin nombrar variables de entorno ni trazas; el modal NO se cierra (R11).
- **P4 (rotación del secreto) — RESUELTA (cambio importante).** Editar la URL **NO** rota el
  secreto: el backend 104 conserva el secreto al editar y solo lo genera en el ALTA. La
  rotación es una **acción explícita** del maestro (botón "Rotar secreto" con confirmación),
  vía **`rotarSecretoWebhook({ ownerUsuarioId })`**. El modal de revelado del secreto se
  dispara SOLO en el ALTA (R7) y en la ROTACIÓN explícita (R21); NUNCA al editar solo la URL
  (R7b). Reflejado en R7/R7b/R19/R20/R21.
- **P5 (reglas de URL) — RESUELTA.** La validación de cliente (R6) reusa
  `registrarWebhookSchema` de `lib/types/webhook.ts` (https). No se inventan reglas extra.

Contrato backend final consumido (todo en la rama de la 104): `registrarWebhook` (result
distingue `creada` con secreto vs `actualizada` sin secreto), `desactivarWebhook`,
`rotarSecretoWebhook` (secreto nuevo una vez) y `obtenerWebhook` (lectura sin secreto).
</content>
</invoke>
