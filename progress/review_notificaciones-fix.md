# Review — Feature 12: notificaciones-fix

> Reviewer (fase 3). Branch: `feature/12-notificaciones-fix`. Fecha: 2026-07-09.
> Spec aprobado por humano. Alcance: backend puro (`lib/actions/ordenes.ts`).

## Veredicto: APROBADO

No hay hallazgos bloqueantes. `./init.sh` en verde. Diff acotado. Trazabilidad R1..R12 completa.

---

## Checklist de revision

- [x] **Trazabilidad R1..R12 -> test.** Cada requisito mapeado a test(s) que aseveran el comportamiento real (ver tabla). Ningun test vacio.
- [x] **Diff acotado.** `git diff --name-only origin/dev` = `feature_list.json`, `lib/actions/ordenes.ts`, `progress/current.md`, `progress/history.md`, `tests/integration/actions/ordenes-action.test.ts`. Unico archivo de PRODUCCION: `lib/actions/ordenes.ts`. `lib/actions/auth.ts` **NO** aparece. `lib/types/orden.ts`, `lib/errors/**`, `app/**`, `components/**`, `tests/components/**` **NO** aparecen.
- [x] **Calidad.** `toActionError` reutiliza las piezas reales de `lib/errors` (importa `withErrorHandler`, `isAppErrorShape`, `UnauthenticatedError`, `ValidationError`, `MSG`, `AppErrorShape`); no reimplementa el mapeo. Switch exhaustivo sobre los 6 `AppErrorCode` + guard `never`. Un unico cast justificado con comentario (`shape.details?.fieldErrors as Record<string,string[]>|undefined`), sin `any` suelto, sin `catch` vacio. Compila strict.
- [x] **Verificacion ejecutable (corrida por el reviewer).** typecheck PASS, lint PASS, 51 files / 384 tests PASS. No requirio `db:generate`.
- [x] **No-regresion UI/asserts.** Test de acciones: 64 inserciones, 0 borrados (asserts previos intactos, solo casos nuevos T13/T14/T15). `tests/components/OrdenesPage.test.tsx` no editado (ausente del diff).

## Decisiones humanas cerradas (verificadas)

1. **INTERNAL -> re-lanzar.** `toActionError` rama `INTERNAL` hace `throw new Error("internal")`. NO devuelve `{status:"error"}` ni nuevo literal. `ActionError` (en `lib/types/orden.ts`, no tocado) sin miembro nuevo. Test "INTERNAL: throw inesperado se re-lanza" asevera `.rejects.toThrow()`. OK.
2. **Alcance solo backend.** Unico archivo de produccion en diff: `lib/actions/ordenes.ts`. OK.
3. **UI-safe.** Contrato `*Result` intacto (`lib/types/orden.ts` sin cambios); `page.tsx` y `OrdenesPage.test.tsx` sin editar. OK.
4. **Conservar `id` en `fieldErrors`.** `throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } })` en obtener/actualizar/borrar; test R9 asevera `Object.keys(fieldErrors) === ["id"]`. OK.

---

## Trazabilidad R1..R12 -> test (verificada)

| R | Test / evidencia | Verificado |
| --- | --- | --- |
| R1 | Enrutado al handler global: `fieldErrorsFrom` eliminado (grep sin residuos), las 5 acciones usan `withErrorHandler(...)`+`toActionError`. Cubierto por no-regresion global (384 verdes). | OK |
| R2 | "R11 ... NumRemisionDuplicadoError -> conflict" e "INTERNAL ... se re-lanza": ambos fluyen por `normalizeError`/`withErrorHandler`. | OK |
| R3 | Imports desde `@/lib/errors`; `toActionError` es inverso de `CODE_BY_DOMAIN_STATUS`, no redefine mapeo; `fieldErrorsFrom` eliminado. Verificado por lectura de codigo + diff. | OK |
| R4 | `*Result`/`ActionError` en `lib/types/orden.ts` sin cambios (ausente del diff); `OrdenesPage.test.tsx` compila/pasa sin editar. | OK |
| R5 | `toActionError` traduce cada code al literal de dominio; tests "R18 -> unauthenticated", "R26/R32/R38 -> validation_error con fieldErrors", "R11 -> conflict". | OK |
| R6 | grep: cero `status:"error"` y cero `code:` fugados; `toActionError` nunca retorna el shape crudo. | OK |
| R7 | "R18: sin sesion valida -> unauthenticated sin tocar el service" con `expect(service.metodo).not.toHaveBeenCalled()`. | OK |
| R8 | "R26/R32/R38: validation_error con fieldErrors sin llamar al service" (crear peso<0/sin zona; listar sortBy invalido; actualizar campo inmutable). | OK |
| R9 | "R9: conserva la clave id" x3 (obtener/actualizar/borrar con id ""), asevera `Object.keys(fieldErrors)===["id"]`. | OK |
| R10 | forbidden/not_found/conflict/ok propagados + "R14b/R42 geografia inexistente -> validation_error" sin alterar. | OK |
| R11 | "R11: ... -> conflict (no lanza, no 500)"; confirmado que `lib/errors/normalize.ts` mapea `NumRemisionDuplicadoError -> CONFLICT` (DOMAIN_ERROR_CODE), el test es real. | OK |
| R12 | No-regresion integracion + `OrdenesPage.test.tsx` sin editar + "INTERNAL re-lanza" + diff sin `auth.ts`; typecheck strict PASS. | OK |

---

## Hallazgos

- **menor (informativo):** R1 y R3 son requisitos estructurales; su evidencia es inspeccion de codigo + no-regresion global (no un assert dedicado). Es adecuado para su naturaleza; no bloquea.
- Sin hallazgos bloqueantes.

## Checkpoints (CHECKPOINTS.md)

Aplicables (backend puro, sin DB/tablas/webhooks/secretos):
- Especificacion: requirements EARS numerado, design con alternativa descartada (A y B), tasks todas `[x]`. OK.
- Trazabilidad: cada R -> test; mapa en `impl_notificaciones-fix.md`. OK.
- Calidad: typecheck/lint/test verde. OK.
- Capas: no se altero separacion (accion delega en service via inyeccion; sin queries en la accion). OK.
- No aplica: RLS/migraciones/down.sql/webhooks/secretos/multi-pais (no hay cambios de datos ni configuracion).
- Verificacion final: `./init.sh` verde; este review OK; entrada en history pendiente de leader.

---

## Salida REAL de `./init.sh` (corrida por el reviewer)

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck
> tsc --noEmit                         (PASS, sin errores)
-> pnpm run lint
> eslint                               (PASS, sin errores)
-> pnpm run test
> vitest run
 Test Files  51 passed (51)
      Tests  384 passed (384)
   Duration  19.18s
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Numeros reales: 51 test files, 384 tests (baseline 379 -> +5: 3 casos R9/T13, 1 R11/T14, 1 INTERNAL/T15). Ningun test perdido.
