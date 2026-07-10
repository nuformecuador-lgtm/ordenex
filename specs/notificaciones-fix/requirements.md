# Feature 12 — notificaciones - fix — requirements.md

## Contexto

Las Server Actions de ordenes en `lib/actions/ordenes.ts` (`crearOrden`,
`obtenerOrden`, `listarOrdenes`, `actualizarOrden`, `borrarOrden`) construyen HOY
sus respuestas de error **a mano**, con literales de dominio armados en el propio
archivo:

- No autenticado: `return { status: "unauthenticated" }` (repetido en las 5 acciones).
- Validacion de payload: `return { status: "validation_error", fieldErrors: fieldErrorsFrom(parsed.error) }`
  (helper local `fieldErrorsFrom` que hace `error.flatten().fieldErrors`).
- Validacion de `id`: `return { status: "validation_error", fieldErrors: { id: ["id invalido"] } }`
  (en `obtenerOrden`, `actualizarOrden`, `borrarOrden`).
- El resto de estados (`forbidden`, `not_found`, `conflict`, `ok`) los produce el
  `OrdenService` y la accion los **pasa tal cual** (ver `tests/integration/actions/ordenes-action.test.ts`).
- Los errores **inesperados** (un `throw` no previsto) no se capturan de forma
  central: hoy revientan como 500 de Next sin forma comun.

La feature 10 (`lib/errors/`, estado `done`) ya entrego el manejador global:
`withErrorHandler`, `normalizeError`, `AppError` (+ subclases `ValidationError`,
`UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`),
`AppErrorShape`/`isAppErrorShape`, `MSG`, `AppErrorCode` y el puente
`CODE_BY_DOMAIN_STATUS`.

Esta feature **migra el manejo de error ad-hoc de las acciones de ordenes** para
que fluya por ese manejador global, entregando una construccion de error unica y
consistente, **sin cambiar el contrato que consume la UI**.

## Alcance y restricciones (decisiones humanas 2026-07-09, NO negociables)

- **Solo ordenes (auth diferido).** El unico archivo de produccion a migrar es
  `lib/actions/ordenes.ts`. `lib/actions/auth.ts` y su switch/case quedan **fuera
  de alcance**.
- **UI-safe.** La UI de `/ordenes` (`app/(app)/ordenes/page.tsx`, que hace
  `if (res.status !== "ok") throw ...`) y sus tests de componente NO deben
  cambiar. El contrato de resultado publico de cada accion
  (`CrearOrdenResult`, `ObtenerOrdenResult`, `ListarOrdenesResult`,
  `ActualizarOrdenResult`, `BorrarOrdenResult`, todos `= { status: "ok"; ... } | ActionError`)
  debe seguir siendo el mismo.
- **Conservar `id` en `fieldErrors`.** Los errores de validacion de `id` en
  `obtenerOrden`/`actualizarOrden`/`borrarOrden` deben seguir teniendo la forma
  `{ status: "validation_error", fieldErrors: { id: [...] } }`.
- **Backend puro.** No se editan componentes, paginas ni tipos consumidos por la
  UI. No se crean tablas, migraciones ni RLS.

---

## Requisitos (EARS)

### Cableado del manejador global

**R1** — El sistema DEBE enrutar el manejo de errores de las cinco Server Actions
de `lib/actions/ordenes.ts` a traves del manejador global de `lib/errors/`
(`withErrorHandler` / `normalizeError`), reemplazando la construccion ad-hoc de
objetos de error literales que existe hoy en ese archivo.

**R2** — CUANDO la logica de una accion de ordenes lanza un error, el sistema DEBE
normalizarlo mediante el manejador global (produciendo internamente un
`AppErrorShape` via `normalizeError`) en lugar de propagar el error crudo o
construir un literal a mano.

**R3** — El sistema NO DEBE reimplementar el mapeo error->categoria dentro de
`lib/actions/ordenes.ts`: DEBE reutilizar las piezas ya exportadas por
`lib/errors/` (`AppError` y subclases, `normalizeError`/`withErrorHandler`,
`isAppErrorShape`, `CODE_BY_DOMAIN_STATUS`, `MSG`). El helper local
`fieldErrorsFrom` armado a mano DEBE dejar de ser la fuente del manejo de error.

### Contrato de salida estable (UI-safe)

**R4** — El sistema DEBE mantener sin cambios el tipo de resultado publico de cada
accion de ordenes: `CrearOrdenResult`, `ObtenerOrdenResult`, `ListarOrdenesResult`,
`ActualizarOrdenResult` y `BorrarOrdenResult` siguen siendo
`{ status: "ok"; ... } | ActionError`, con `ActionError` discriminado por los
literales de dominio `"validation_error" | "unauthenticated" | "forbidden" | "not_found" | "conflict"`.

**R5** — CUANDO una accion de ordenes normaliza un error a un `AppErrorShape`
(`status: "error"`, `code: AppErrorCode`), el sistema DEBE traducirlo al literal de
dominio equivalente antes de retornar, usando el mapeo inverso de
`CODE_BY_DOMAIN_STATUS` (`VALIDATION_ERROR->validation_error`,
`UNAUTHORIZED->unauthenticated`, `FORBIDDEN->forbidden`, `NOT_FOUND->not_found`,
`CONFLICT->conflict`), de modo que la UI reciba exactamente el mismo `status` que
recibe hoy.

**R6** — El sistema NO DEBE emitir hacia el consumidor de la UI un objeto con
`status: "error"` ni exponer `code` de `AppErrorCode` en el resultado de las
acciones de ordenes; la traduccion a literal de dominio (R5) DEBE ocurrir dentro
de la accion.

### Preservacion de comportamiento por caso

**R7** — MIENTRAS no exista una sesion valida (actor nulo), el sistema DEBE
devolver `{ status: "unauthenticated" }` sin invocar al `OrdenService`, igual que
hoy (una accion no toca la capa de ordenes si el actor es nulo).

**R8** — CUANDO el payload de entrada de `crearOrden`, `listarOrdenes` o
`actualizarOrden` no supera la validacion de su schema zod, el sistema DEBE
devolver `{ status: "validation_error", fieldErrors }` con los `fieldErrors`
aplanados por campo, sin invocar al `OrdenService`.

**R9** — CUANDO el `id` recibido por `obtenerOrden`, `actualizarOrden` o
`borrarOrden` no supera `idSchema` (`z.string().min(1)`), el sistema DEBE devolver
`{ status: "validation_error", fieldErrors: { id: [...] } }`, conservando la clave
`id` en `fieldErrors`.

**R10** — CUANDO el `OrdenService` devuelve un resultado de dominio
(`{ status: "ok" | "forbidden" | "not_found" | "conflict" | "validation_error" }`),
el sistema DEBE propagarlo sin alterarlo (paso transparente del exito y de los
errores ya tipados por el service).

**R11** — SI la logica de una accion de ordenes lanza un error de dominio conocido
por su nombre de constructor (p. ej. `NumRemisionDuplicadoError`,
`CatalogoInvalidoError`), ENTONCES el sistema DEBE mapearlo mediante el manejador
global al literal de dominio correspondiente (`conflict`, `validation_error`) en
vez de dejarlo escapar como error 500.

### No regresion y calidad

**R12** — El sistema NO DEBE modificar el comportamiento observable de la UI de
`/ordenes` ni exigir cambios en `app/(app)/ordenes/page.tsx` ni en
`tests/components/OrdenesPage.test.tsx`; los tests de componente e integracion
existentes DEBEN seguir pasando sin editarse. La migracion DEBE compilar bajo
TypeScript `strict`, sin `any` no justificado y sin `catch` vacios
(`docs/conventions.md`), y `lib/actions/auth.ts` NO DEBE tocarse.

---

## Trazabilidad

Todos los requisitos R1..R12 se mapean a tests en `tasks.md` (bloque
"Mapa R -> test"). Los tests de integracion de acciones ya existentes
(`tests/integration/actions/ordenes-action.test.ts`) cubren el comportamiento
observable (R7..R10, R12) y NO deben cambiar de asserts; se agregan casos nuevos
para las rutas de normalizacion (R2, R5, R11).

---

## Decisiones cerradas (humano, 2026-07-09)

- **[RESUELTO] Errores INTERNAL hacia la UI → RE-LANZAR.** El manejador global
  normaliza los errores inesperados a `code: "INTERNAL"`, pero `ActionError`
  (contrato UI) no tiene un miembro equivalente. Decision humana: **re-lanzar** el
  error inesperado tras registrarlo por el logger del manejador (la UI ya trata el
  `throw` como error generico, ver test D4). NO se introduce un nuevo miembro tipado
  en `ActionError` (mantiene el contrato intacto → UI-safe). Fija R6/R12 y la rama
  `INTERNAL -> re-throw` del adaptador `toActionError` (T3, testeada por T15).

- **[RESUELTO] Alcance = solo backend.** "reemplaza los mensajes de error" se
  refiere a **unificar la construccion del error en backend** (esta feature). Los
  toasts / render de texto al usuario son la feature 11 (`notificaciones`, aun
  `pending`) y quedan FUERA de alcance aqui. La feature permanece en zona backend
  pura (no toca UI).
