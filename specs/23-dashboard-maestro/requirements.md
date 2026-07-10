# Feature 23 — Dashboard del admin maestro · requirements.md

> Zona: **frontend puro**. Consume el backend de la feature 22 (Server Actions de
> aprobación de postulaciones, ya en `dev`). NO crea backend, DB ni actions.
> Depende de la feature 22.

## Contexto (hechos verificados, no supuestos)

- La home autenticada es `app/(app)/page.tsx`. Hoy: si el actor es `adminTienda`
  renderiza `AdminTiendaDashboard` (feature 26); cualquier otro rol o sesión
  ausente ve el placeholder "Bienvenido". El rol se resuelve **server-side** con
  `resolveActorFromSession()` (devuelve `{ usuarioId, rol: RolValue } | null`).
- `RolValue` = `maestro | admin | mensajero | adminTienda | adminSatelite`
  (`db/schema.prisma`).
- Backend consumido (`lib/actions/aprobacion-postulaciones.ts`):
  - `listarPostulacionesPendientes(input)` → `ListarPostulacionesResult` =
    `{ status: "ok"; items: PostulacionPendienteDTO[]; page; pageSize; total } | ActionError`.
  - `aprobarPostulacion(id)` → `DecisionResult` =
    `{ status: "ok"; usuarioId; estado: "activo" } | ActionError`.
  - `rechazarPostulacion(id)` → `DecisionResult` =
    `{ status: "ok"; usuarioId; estado: "inactivo" } | ActionError`.
  - `ActionError.status` ∈ `validation_error | unauthenticated | forbidden | not_found | conflict`.
  - `PostulacionPendienteDTO` = `{ usuarioId, nombre, primerApellido|null,
    segundoApellido|null, email, telefono, tipoIdentificacion, cedula,
    vehiculo|null, placa|null, documentos: DocumentoFirmadoDTO[] }`.
  - `DocumentoFirmadoDTO` = `{ tipo: MensajeroDocumentoTipo, url, expiresInSeconds }`;
    `tipo` ∈ `cedula_anverso | cedula_reverso | propiedad_anverso |
    propiedad_reverso | foto_rostro` (los 5 documentos).
- Componentes reutilizables disponibles: `PageHeader`, `Pagination`, `Modal`
  (async: spinner + bloqueo del confirmar + `onError`), `ToastProvider`/`useToast`
  (ya montado en `app/(app)/layout.tsx`).

## Requisitos (EARS)

### Ramificación de la home por rol

- **R1** — SI el actor autenticado tiene rol `maestro` o `admin`, ENTONCES la home
  (`app/(app)/page.tsx`) DEBE renderizar el dashboard del admin maestro que
  contiene el panel de postulaciones pendientes de mensajeros.
- **R2** — SI el actor tiene rol `adminTienda`, ENTONCES la home DEBE seguir
  renderizando el dashboard de tienda (feature 26) sin alteraciones.
- **R3** — SI el actor tiene un rol distinto de `maestro`, `admin` y `adminTienda`
  (es decir `mensajero` o `adminSatelite`), O NO hay sesión válida (actor `null`),
  ENTONCES la home DEBE conservar el placeholder "Bienvenido" actual.
- **R4** — El sistema DEBE resolver el rol únicamente en el servidor mediante
  `resolveActorFromSession()`; la ramificación de la home NO DEBE depender de
  ningún dato leído en el cliente.

### Composición del dashboard maestro

- **R5** — El dashboard del admin maestro DEBE mostrar un encabezado con
  `PageHeader` y, como único bloque funcional, el panel de postulaciones
  pendientes (la pantalla "arranca en blanco" salvo ese panel).

### Panel de postulaciones pendientes — listado y datos

- **R6** — CUANDO se monta el panel, el sistema DEBE invocar
  `listarPostulacionesPendientes` y mostrar las postulaciones que devuelve.
- **R7** — Para cada postulación listada, el panel DEBE mostrar los datos del
  mensajero: nombre, primer y segundo apellido, email, teléfono, tipo de
  identificación, número de documento (cédula), vehículo y placa (los campos
  nulos se muestran como vacío o guion, sin romper el render).
- **R8** — Para cada postulación, el panel DEBE ofrecer acceso a sus 5 documentos
  usando las URLs firmadas de `documentos[]`, mediante un enlace "Ver" por
  documento con etiqueta legible según su `tipo`, que abre la URL en una pestaña
  nueva.
- **R9** — El panel DEBE paginar el listado reutilizando el componente
  `Pagination`, usando `page`, `pageSize` y `total` devueltos por el backend.

### Estados de la UI

- **R10** — MIENTRAS se cargan las postulaciones, el panel DEBE mostrar un estado
  de carga.
- **R11** — SI el listado se resuelve sin postulaciones pendientes (`items` vacío),
  ENTONCES el panel DEBE mostrar el mensaje "No hay postulaciones pendientes".
- **R12** — SI `listarPostulacionesPendientes` devuelve un `ActionError` (o falla),
  ENTONCES el panel DEBE mostrar un estado de error legible, sin filtrar detalles
  internos ni PII.

### Aprobar / rechazar

- **R13** — Cada postulación listada DEBE ofrecer un botón "Aprobar" y un botón
  "Rechazar".
- **R14** — CUANDO el usuario pulsa "Aprobar" o "Rechazar" sobre una postulación,
  el sistema DEBE solicitar confirmación en un `Modal` antes de ejecutar la acción
  (el mensaje del modal identifica al mensajero y la acción a realizar).
- **R15** — CUANDO el usuario confirma en el modal, el sistema DEBE invocar
  `aprobarPostulacion(usuarioId)` o `rechazarPostulacion(usuarioId)` según el botón
  pulsado, pasando el `usuarioId` de esa postulación.
- **R16** — MIENTRAS corre la Server Action de aprobar/rechazar, el `Modal` DEBE
  mostrar el spinner y bloquear el botón de confirmación (impidiendo el doble
  envío) hasta que la acción resuelva o rechace.
- **R17** — CUANDO la Server Action devuelve `status: "ok"`, el sistema DEBE
  mostrar un `Toast` de éxito, cerrar el modal y refrescar el listado, de modo que
  la postulación resuelta desaparezca del panel.
- **R18** — SI la Server Action devuelve un `ActionError`, ENTONCES el sistema DEBE
  mostrar un `Toast` de error con un mensaje mapeado del `status`
  (`forbidden`, `unauthenticated`, `not_found`, `conflict`, `validation_error`) y
  mantener la postulación en el listado.

### Alcance

- **R19** — El panel NO DEBE implementar la lógica de aprobación/rechazo ni acceso
  a datos/almacenamiento; DEBE limitarse a consumir las Server Actions de la
  feature 22 y presentar sus resultados.

## Preguntas abiertas (para la puerta F1.4)

- **A1 — Presentación de documentos.** Se decide enlaces "Ver" (una pestaña nueva
  por documento). ¿El maestro necesita previsualización inline (miniaturas/visor)
  o basta el enlace? Impacta R8. Decisión de producto pendiente de confirmar.
- **A2 — Caducidad de las URLs firmadas.** El TTL por defecto es 300 s
  (`APROBACION_SIGNED_URL_TTL_SECONDS`). Si el maestro tarda más en revisar, los
  enlaces caducan. ¿La UI debe re-listar para refrescar las URLs (p. ej. botón
  "Actualizar" o refetch periódico), o se acepta que un enlace caducado obligue a
  recargar la página? Impacta R8/R9.
- **A3 — Rechazo sin motivo.** `rechazarPostulacion(id)` de la feature 22 solo
  recibe el `id` (no acepta motivo). Se asume rechazo sin captura de motivo. ¿Se
  confirma? Impacta R14/R15.
