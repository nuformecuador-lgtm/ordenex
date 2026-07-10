# Feature 12 — notificaciones - fix — tasks.md

> Alcance: SOLO `lib/actions/ordenes.ts` (+ casos de test). NO tocar
> `lib/actions/auth.ts`, `lib/types/orden.ts`, `lib/errors/**`, `app/**`,
> `components/**`. `[P]` = paralelizable con la task hermana marcada.

## Preparacion

- [x] **T1 — Confirmar API del manejador.** Releer exports reales de
  `lib/errors/index.ts` (`withErrorHandler`, `normalizeError`, `isAppErrorShape`,
  `AppError`, `ValidationError`, `UnauthenticatedError`, `CODE_BY_DOMAIN_STATUS`,
  `MSG`, tipos `AppErrorShape`/`AppErrorCode`).
  Hecho: lista de simbolos a importar fijada, sin inventar nombres.

- [x] **T2 — Confirmar contrato UI a preservar.** Verificar en
  `lib/types/orden.ts` que `ActionError` y los `*Result` NO cambian, y en
  `app/(app)/ordenes/page.tsx` que solo se evalua `res.status !== "ok"`.
  Hecho: se documenta que ningun tipo publico se edita.

## Implementacion (en orden; dependen de T1/T2)

- [x] **T3 — Adaptador `toActionError(shape): ActionError`** en
  `lib/actions/ordenes.ts`, inverso de `CODE_BY_DOMAIN_STATUS`
  (`VALIDATION_ERROR->validation_error` copiando `details.fieldErrors`,
  `UNAUTHORIZED->unauthenticated`, `FORBIDDEN->forbidden`, `NOT_FOUND->not_found`,
  `CONFLICT->conflict`, `INTERNAL->re-throw`).
  Hecho: la funcion compila strict, sin `any` sin justificar; cubre los 6 codes. (R5, R6)

- [x] **T4 — Migrar `crearOrden`.** Cuerpo dentro de `withErrorHandler`:
  actor nulo -> `throw new UnauthenticatedError()`; `crearOrdenSchema.parse(input)`;
  llamar al service y retornar su resultado. Retorno final:
  `isAppErrorShape(r) ? toActionError(r) : r`.
  Hecho: se elimina el `return { status: "unauthenticated" }` y el
  `safeParse`+literal manual de esta accion. (R1, R2, R7, R8, R10)

- [x] **T5 — Migrar `obtenerOrden`.** actor nulo -> `UnauthenticatedError`;
  `id` invalido -> `throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } })`;
  service -> retorno; adaptar con `toActionError`.
  Hecho: `fieldErrors.id` se conserva en el resultado. (R7, R9, R10)

- [x] **T6 — Migrar `listarOrdenes`.** actor nulo -> `UnauthenticatedError`;
  `listarOrdenesSchema.parse(input ?? {})`; service -> retorno; adaptar.
  Hecho: sortBy fuera de lista blanca sigue dando `validation_error` con
  `fieldErrors`. (R7, R8, R10)

- [x] **T7 — Migrar `actualizarOrden`.** actor nulo -> `UnauthenticatedError`;
  `id` invalido -> `ValidationError` con `{ id: [...] }`;
  `actualizarOrdenSchema.parse(input)` (campo inmutable -> `ZodError`);
  service -> retorno; adaptar.
  Hecho: `id` invalido y payload invalido dan ambos `validation_error`, el de `id`
  conserva la clave. (R7, R8, R9, R10)

- [x] **T8 — Migrar `borrarOrden`.** actor nulo -> `UnauthenticatedError`;
  `id` invalido -> `ValidationError` con `{ id: [...] }`; service -> retorno; adaptar.
  Hecho: `not_found`/`forbidden` del service se propagan sin cambio. (R7, R9, R10)

- [x] **T9 — Limpiar `fieldErrorsFrom` ad-hoc.** Eliminar el helper local si ya no
  se usa tras T4/T6/T7 (el aplanado ahora lo hace `normalizeError`).
  Hecho: no queda construccion de error literal fuera del camino del handler. (R1, R3)

- [x] **T10 — Barrido de no-fuga.** Verificar por grep que ninguna accion retorna
  `{ status: "error" }` ni `code:` de `AppErrorCode` hacia la UI; todo error sale
  como literal de dominio via `toActionError`.
  Hecho: cero apariciones de `status: "error"` en el resultado publico. (R6)

## Tests (cubren cada R; en paralelo entre si tras la implementacion)

- [x] **T11 [P] — No-regresion de acciones.** Correr
  `tests/integration/actions/ordenes-action.test.ts` SIN editar sus asserts;
  deben pasar tal cual (unauthenticated sin tocar service, validation_error con
  fieldErrors, propagacion de forbidden/not_found/conflict/ok, geografia
  inexistente).
  Hecho: verde sin cambios. (R7, R8, R10, R12)

- [x] **T12 [P] — No-regresion de UI.** Correr
  `tests/components/OrdenesPage.test.tsx` (D1..D7) SIN editar; el caso D4
  (`{ status: "unauthenticated" | "forbidden" | "validation_error" }` como
  `ListarOrdenesResult`) sigue compilando y pasando.
  Hecho: verde sin cambios; confirma UI-safe. (R4, R12)

- [x] **T13 [P] — Test nuevo: conservar `id`.** Caso que fuerza `id` invalido
  (`""`) en obtener/actualizar/borrar y afirma
  `fieldErrors.id` definido y `Object.keys(fieldErrors) === ["id"]`.
  Hecho: assert de la clave `id`. (R9)

- [x] **T14 [P] — Test nuevo: normalizacion de throw inesperado.** Inyectar un
  `ordenService` cuyo metodo lanza `NumRemisionDuplicadoError` (o un `Error` con
  `name` mapeado) y afirmar que la accion devuelve `{ status: "conflict" }` (no un
  500 crudo), pasando por el handler.
  Hecho: assert de mapeo dominio-por-nombre. (R2, R11)

- [x] **T15 [P] — Test nuevo: INTERNAL re-lanzado.** Inyectar un `ordenService` que
  lanza un `Error` desconocido y afirmar que la accion **rechaza** (throw), igual
  que hoy (comportamiento observado por SWR en D4).
  Hecho: assert de rechazo. (R2, R12, cubre [ABIERTO] INTERNAL)

## Verificacion final

- [x] **T16 — Suite + calidad.** `npm run typecheck`, `npm run lint`, `npm test` y
  `./init.sh` en verde. Confirmar que `lib/actions/auth.ts` no aparece en el diff.
  Hecho: todo verde; diff acotado a `lib/actions/ordenes.ts` y al test de acciones.
  (R12)

---

## Mapa R -> test

| R | Test |
| --- | --- |
| R1 | T9/T10 (no queda construccion ad-hoc) + revision de diff en T16 |
| R2 | T14, T15 (errores fluyen por `normalizeError`/`withErrorHandler`) |
| R3 | T9 (elimina `fieldErrorsFrom`) + revision de imports (T1) |
| R4 | T12 (tipos `*Result` intactos, D4 compila) |
| R5 | T11 (unauthenticated/validation_error) + T14 (conflict via inverso de code) |
| R6 | T10 (ningun `status:"error"`/`code` fugado) + T11 |
| R7 | T11 (unauthenticated sin tocar service) |
| R8 | T11 (crear peso<0, listar sortBy invalido, actualizar campo inmutable) |
| R9 | T13 (fieldErrors.id conservado) |
| R10 | T11 (forbidden/not_found/conflict/ok + geografia inexistente propagados) |
| R11 | T14 (error de dominio por `err.name` -> conflict) |
| R12 | T11, T12, T15, T16 (no-regresion, auth intacto, diff acotado) |
