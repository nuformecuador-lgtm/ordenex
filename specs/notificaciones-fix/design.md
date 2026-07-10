# Feature 12 — notificaciones - fix — design.md

## Objetivo

Migrar el manejo de error ad-hoc de las cinco Server Actions de
`lib/actions/ordenes.ts` para que fluya por el manejador global de la feature 10
(`lib/errors/`), manteniendo intacto el contrato de resultado que consume la UI
(`{ status: "ok"; ... } | ActionError`) y conservando la forma `{ id: [...] }` en
los `fieldErrors` de validacion de `id`.

## Archivos afectados

- **Editar (unico de produccion):** `lib/actions/ordenes.ts`.
- **NO tocar:** `lib/actions/auth.ts`, `lib/types/orden.ts` (los tipos de
  contrato se conservan), `lib/errors/**` (se consume su API tal cual),
  `app/(app)/ordenes/**`, `components/**`.
- **Tests:** se agregan casos en `tests/integration/actions/ordenes-action.test.ts`
  (sin cambiar los asserts existentes) para cubrir R2/R5/R11.

## Modelo de datos

No aplica. No hay tablas, migraciones ni RLS: es codigo de aplicacion puro.

## API real del manejador global que se reutiliza (leida de `lib/errors/`)

- `withErrorHandler<T>(fn: () => Promise<T>, logger?): Promise<T | AppErrorShape>`
  — ejecuta `fn`, devuelve su valor si tiene exito (paso transparente) o un
  `AppErrorShape` normalizado si lanza.
- `normalizeError(err, logger?): AppErrorShape` — `AppError`->su shape;
  `ZodError`->`VALIDATION_ERROR` con `details.fieldErrors`; error de dominio
  conocido por `err.name`->code mapeado; desconocido->`INTERNAL` (loggeado, sin PII).
- Clases: `AppError`, `ValidationError`, `UnauthenticatedError`, `ForbiddenError`,
  `NotFoundError`, `ConflictError` (subclases fijan `code` y `message` por defecto;
  aceptan `details`).
- `AppErrorShape = { status: "error"; code: AppErrorCode; message: string; details?: Record<string, unknown> }`
  y `isAppErrorShape(v): v is AppErrorShape`.
- `CODE_BY_DOMAIN_STATUS = { validation_error: "VALIDATION_ERROR", unauthenticated: "UNAUTHORIZED", forbidden: "FORBIDDEN", not_found: "NOT_FOUND", conflict: "CONFLICT" }`
  (puente dominio->code; su **inverso** es lo que necesita esta feature).
- `AppErrorCode = "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL"`.

## Diseno elegido: envolver + adaptar de vuelta a literal de dominio

Cada accion queda con esta forma:

1. Ejecuta su cuerpo dentro de `withErrorHandler(async () => { ... })`.
2. Dentro del cuerpo, las condiciones de error se expresan **lanzando** las
   clases del manejador global en vez de retornar literales a mano:
   - actor nulo -> `throw new UnauthenticatedError()`.
   - payload invalido -> `schema.parse(input)` (lanza `ZodError`) en vez de
     `safeParse` + retorno manual.
   - `id` invalido -> `throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } })`.
   - el resultado del `OrdenService` se **retorna** (es un valor de exito para el
     wrapper, incluidos sus `status` de dominio como `forbidden`/`not_found`/`conflict`).
3. `withErrorHandler` devuelve `ResultadoDominio | AppErrorShape`. La accion aplica
   un adaptador final:

```ts
// Inverso de CODE_BY_DOMAIN_STATUS (VALIDATION_ERROR->validation_error, ...).
// Vive en lib/actions/ordenes.ts; deriva del mapa exportado, no lo redefine a mano.
function toActionError(shape: AppErrorShape): ActionError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return { status: "validation_error",
               fieldErrors: (shape.details?.fieldErrors as Record<string, string[]>) ?? {} };
    case "UNAUTHORIZED": return { status: "unauthenticated" };
    case "FORBIDDEN":    return { status: "forbidden" };
    case "NOT_FOUND":    return { status: "not_found" };
    case "CONFLICT":     return { status: "conflict" };
    case "INTERNAL":     throw new Error("internal"); // [ABIERTO] R12: preserva el 500 de hoy
  }
}
```

Y el retorno de cada accion:

```ts
const r = await withErrorHandler(async () => { /* auth + parse + service */ });
return isAppErrorShape(r) ? toActionError(r) : r; // r no-shape = resultado de dominio (ok/forbidden/...)
```

### Como cada requisito cae en su sitio

- **R7 (unauthenticated sin tocar service):** el `throw new UnauthenticatedError()`
  ocurre antes de instanciar/llamar al service; `normalizeError` -> `UNAUTHORIZED`
  -> `toActionError` -> `{ status: "unauthenticated" }`.
- **R8 (validacion payload):** `schema.parse` lanza `ZodError`; `normalizeError`
  produce `details.fieldErrors` aplanados; `toActionError` lo copia a
  `{ status: "validation_error", fieldErrors }`. La forma es identica a la de hoy
  (`z.flattenError` y `error.flatten().fieldErrors` producen el mismo shape por campo).
- **R9 (conservar `id`):** se lanza `ValidationError` con
  `details.fieldErrors = { id: ["id invalido"] }`; `normalizeError` (rama `AppError`)
  preserva `details`; `toActionError` devuelve `{ id: [...] }` intacto.
- **R10 (paso transparente del service):** el resultado del service es el valor de
  exito del wrapper; `isAppErrorShape` es `false` para el, y se retorna sin cambios
  (incluye `ok`, `forbidden`, `not_found`, `conflict`, y el `validation_error` que
  el propio service ya devuelve, p. ej. geografia inexistente).
- **R11 (errores de dominio por nombre):** si algo lanza `NumRemisionDuplicadoError`
  / `CatalogoInvalidoError`, `normalizeError` los mapea a `CONFLICT` /
  `VALIDATION_ERROR` y `toActionError` a `conflict` / `validation_error`.
- **R5/R6 (traduccion a literal, sin fugar `status:"error"`/`code`):** todo pasa por
  `toActionError`; nunca se retorna el `AppErrorShape` crudo.

### Por que esto es UI-safe (R4, R12)

`app/(app)/ordenes/page.tsx` solo evalua `res.status !== "ok"`. Como el contrato
sigue siendo `{ status: "ok"; ... } | ActionError`, el narrowing del `?.status` no
cambia. El test de componente `OrdenesPage.test.tsx` (caso D4) construye errores
como `{ status: "unauthenticated" }`, `{ status: "forbidden" }`,
`{ status: "validation_error", fieldErrors }` tipados como `ListarOrdenesResult`:
siguen siendo validos porque `Actualizar/Listar...Result` no cambian de tipo. Cero
ediciones en UI ni en sus tests.

## Alternativa descartada

**Alternativa A — Exponer `AppErrorShape` directamente al consumidor: cambiar el
tipo de resultado de las acciones a `{ status: "ok"; ... } | AppErrorShape`.**

Rechazada porque:

1. Rompe la restriccion UI-safe (decision humana #2). Aunque `page.tsx` sobrevive
   (solo mira `!== "ok"`), el **tipo** `ListarOrdenesResult` cambiaria y el test de
   componente `OrdenesPage.test.tsx` (D4), que construye `{ status: "unauthenticated" }`
   tipado como `ListarOrdenesResult`, dejaria de compilar. Eso obliga a editar
   `tests/components/**`, contradiciendo "la UI existente no requiere cambios".
2. Cambiaria el discriminante de `"unauthenticated" | ...` a `"error"` + `code`,
   perdiendo los literales de dominio semanticos que el resto del contrato usa y
   que el service sigue produciendo (habria dos vocabularios de error conviviendo
   en la misma union: los del service en paso transparente y los del handler).
3. No aporta valor a esta feature: el objetivo es unificar la **construccion**
   interna del error, no rediseñar el contrato publico (eso seria otra feature).

**Alternativa B (parcial) descartada — mantener `safeParse` + `if (!parsed.success)`
y solo envolver los throws inesperados.** Se prefirio lanzar (`parse`,
`UnauthenticatedError`, `ValidationError`) y centralizar TODO en `withErrorHandler`,
para que exista **un solo camino** de construccion de error (R1/R3) en vez de dos
(uno ad-hoc para lo esperado y otro global para lo inesperado), que es justamente
la inconsistencia que la feature elimina.

## Notas de implementacion

- `toActionError` deriva del inverso de `CODE_BY_DOMAIN_STATUS`; no se redefine el
  mapeo a mano para no divergir de la fuente de la feature 10.
- El caso `INTERNAL` se re-lanza (ver [ABIERTO] en requirements): preserva el 500
  actual y evita inventar un miembro nuevo en `ActionError`.
- Sin `any` sin justificar: el `shape.details?.fieldErrors` se castea a
  `Record<string, string[]>` con comentario (frontera ya validada por el handler).
- `resolveActorFromSession`, `buildOrdenService` y `OrdenActionDeps` (inyeccion de
  `ordenService`/`getActor`) se conservan intactos para que los tests actuales sigan
  inyectando fakes igual que hoy.
