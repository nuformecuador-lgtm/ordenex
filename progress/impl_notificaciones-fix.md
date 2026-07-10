# Bitacora de implementacion — Feature 12: notificaciones-fix

> Fase 2 (implementer). Branch: `feature/12-notificaciones-fix`. Spec aprobado por humano (2026-07-09).
> Alcance: backend puro. Migrar el manejo de error ad-hoc de `lib/actions/ordenes.ts`
> al manejador global `lib/errors/`, sin cambiar el contrato UI.

## Estado: COMPLETO — verde en `./init.sh`.

## Archivos tocados (produccion + tests)

- **Produccion (unico):** `lib/actions/ordenes.ts`
  - Nuevo adaptador `toActionError(shape: AppErrorShape): ActionError` — inverso de
    `CODE_BY_DOMAIN_STATUS`, switch exhaustivo sobre los 6 `AppErrorCode` (+ guard
    `never` en default). Rama `INTERNAL` **re-lanza** (`throw new Error("internal")`)
    segun decision humana cerrada; NO agrega miembro a `ActionError`.
  - Las 5 acciones (`crearOrden`, `obtenerOrden`, `listarOrdenes`, `actualizarOrden`,
    `borrarOrden`) migradas al patron
    `const r = await withErrorHandler(async () => { ... }); return isAppErrorShape(r) ? toActionError(r) : r;`.
    - actor nulo -> `throw new UnauthenticatedError()` ANTES de instanciar el service (R7).
    - payload -> `schema.parse(input)` (lanza `ZodError`; se acabo el `safeParse`+literal).
    - `id` invalido -> `idSchema.safeParse` + `throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } })` (conserva clave `id`, R9).
  - Eliminado el helper local `fieldErrorsFrom` (T9): el aplanado ahora lo hace
    `normalizeError` via `z.flattenError`.
- **Tests:** `tests/integration/actions/ordenes-action.test.ts` — SOLO se agregaron
  casos nuevos al final (T13/T14/T15); los asserts/casos existentes NO se editaron.

Archivos de contrato/UI NO tocados (confirmado): `lib/actions/auth.ts`,
`lib/types/orden.ts`, `lib/errors/**`, `app/**`, `components/**`, `tests/components/**`.
`git diff --name-only` de codigo: solo `lib/actions/ordenes.ts` y el test de acciones
(los otros 3 — `feature_list.json`, `progress/current.md`, `progress/history.md` — son
estado de orquestacion previo a la delegacion, no codigo).

## Mapa R -> test (cada R a un test concreto verificable)

| R | Test que lo cubre (archivo: describe > it) |
| --- | --- |
| R1 | Cableado verificado por no-regresion global (`ordenes-action.test.ts` 384 verdes) + eliminacion de `fieldErrorsFrom` (revision de diff) |
| R2 | `ordenes-action.test.ts` > "R11: error de dominio por nombre -> conflict via handler" > "crear con NumRemisionDuplicadoError -> conflict" + "INTERNAL: throw inesperado se re-lanza" > "crear con error desconocido -> la accion rechaza" (ambos fluyen por `normalizeError`/`withErrorHandler`) |
| R3 | Imports desde `@/lib/errors` (T1) + eliminacion de `fieldErrorsFrom` (T9) — verificado en el diff; grep sin residuos ad-hoc |
| R4 | `tests/components/OrdenesPage.test.tsx` (D4) compila y pasa sin editar; `*Result` intactos |
| R5 | "R18: sin sesion valida -> unauthenticated" + "R26/R32/R38: validation_error con fieldErrors" (traduccion inversa de code) + "R11 ... -> conflict" |
| R6 | grep en `ordenes.ts`: cero `status: "error"` y cero `code:` fugados hacia la UI (T10) + suite verde |
| R7 | "R18: sin sesion valida -> unauthenticated sin tocar el service" (asserts `service.metodo not.toHaveBeenCalled()`) |
| R8 | "R26/R32/R38: validation_error con fieldErrors sin llamar al service" (crear peso<0/sin zona, listar sortBy invalido, actualizar campo inmutable) |
| R9 | "R9: conserva la clave id en fieldErrors" > obtener/actualizar/borrar con id "" -> `Object.keys(fieldErrors) === ["id"]` |
| R10 | "R19-R24/R41", "R29", "R30...", "R35...", "R28", "R14b/R42" (forbidden/not_found/conflict/ok + geografia inexistente propagados sin alterar) |
| R11 | "R11: error de dominio por nombre -> conflict via handler" > "crear con NumRemisionDuplicadoError -> conflict (no lanza, no 500)" |
| R12 | Suite de integracion + `tests/components/OrdenesPage.test.tsx` sin editar + "INTERNAL ... rechaza" + diff acotado (auth.ts ausente) |

## Salida REAL de verificacion (`./init.sh`)

```
-> pnpm run typecheck   (tsc --noEmit)   PASS, sin errores
-> pnpm run lint        (eslint)          PASS, sin warnings/errores
-> pnpm run test        (vitest run)
   Test Files  51 passed (51)
        Tests  384 passed (384)
   Duration   19.86s
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline previo: 51 files / 379 tests. Ahora: 51 files / **384 tests** (+5:
3 casos T13, 1 T14, 1 T15). No baja ningun test.

## Deuda / decisiones

- **INTERNAL -> re-lanzar:** implementado como `throw new Error("internal")` en la rama
  `INTERNAL` de `toActionError`. El error real ya fue loggeado por `normalizeError`
  (canal servidor, sin PII); se re-lanza un `Error` generico para preservar el 500
  actual sin exponer internals ni ampliar el contrato `ActionError`. Decision humana
  cerrada (2026-07-09) — NO es deuda abierta, queda documentada.
- Sin `any` sin justificar: el unico cast es `shape.details?.fieldErrors as Record<string, string[]> | undefined` en la frontera ya validada por el handler, con comentario.
- Sin bloqueos.
