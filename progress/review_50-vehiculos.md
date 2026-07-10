# Review — vehiculos (feature 50)

> Reviewer. Verificación contra `specs/50-vehiculos/{requirements,design,tasks}.md`,
> `docs/{conventions,architecture,verification}.md` y `CHECKPOINTS.md`. Worktree
> `ordenex-f50` (rama `feature/50-vehiculos`). Ejecución con **npm**.

## Veredicto: CAMBIOS REQUERIDOS

Código completo y correcto en alcance P1=A (solo lectura sembrada); typecheck/lint/test
verdes. Se bloquea por dos brechas de CHECKPOINTS de tipo bookkeeping (no de código):
tasks.md sin marcar y falta la entrada en history.md.

## Verificación ejecutable (corrida por el reviewer)

- `npm run typecheck` (`tsc --noEmit`): **VERDE** (exit 0).
- `npm run lint` (`eslint`): **VERDE** — 0 errores; 135 warnings, todos en
  `.claude/skills/**` (ajenos a la feature).
- `npm test` (`vitest run`): **VERDE** — `91 files / 754 passed`. No apareció el flaky
  `no-embalaje` en esta corrida.
- Tests nuevos de vehiculos aislados: **33 passed** (5 files).
- R15 (backend puro): sin archivos nuevos bajo `app/` ni `components/` (git verificado).
- R12 N/A confirmado: interfaz/service/repository/action exponen SOLO `listar`/`obtener`
  (`findMany`/`findById`); no hay `crear/actualizar/borrar` ni zod de escritura ni
  `validation_error`/`conflict`. Migración sin `CREATE TABLE` de escritura extra.

## Trazabilidad R → test

| R | Requisito | Test / verificación | Estado |
|---|-----------|---------------------|--------|
| R1 | enum `VehiculoValue` 3 miembros, sin `@map`, `@@map("vehiculo_value")` | `tests/unit/types/vehiculos.test.ts` (enum) | OK |
| R2 | model `Vehiculo` columna `name @unique`, `@@map("vehiculos")`, sin `value` | `tests/unit/types/vehiculos.test.ts` (modelo) | OK |
| R3 | migration.sql: CREATE TYPE/TABLE/INDEX + RLS; sin editar previas | `tests/integration/db/vehiculos-migration.test.ts` (UP + timestamp) | OK |
| R4 | down.sql: DROP TABLE antes de DROP TYPE | `vehiculos-migration.test.ts` (DOWN, orden) | OK |
| R5 | rollback seguro (orden drop; falla si hubiera FK) | `vehiculos-migration.test.ts` (orden DROP + sin FKs) | OK |
| R6 | `VEHICULOS_SEED` deriva del enum, longitud 3 | `tests/unit/types/vehiculos.test.ts` (SEED) | OK |
| R7 | `seedVehiculos` persiste 3 filas por `name` | `tests/unit/scripts/seed-vehiculos.test.ts` (siembra + upsert por name) | OK |
| R8 | idempotencia: 2 corridas → 3 filas, id estable | `seed-vehiculos.test.ts` (idempotente) | OK |
| R9 | maestro autorizado (listar/obtener) | `tests/unit/services/vehiculo-service.test.ts` (maestro→ok) | OK |
| R10 | no maestro → forbidden / sin sesión → unauthenticated | `vehiculo-service.test.ts` + `tests/integration/actions/vehiculos-action.test.ts` | OK |
| R11 | maestro lista/obtiene 3 filas con id+name, sin campos internos | `vehiculo-service.test.ts` + `vehiculos-action.test.ts` (ok, 3 filas) | OK |
| R12 | escritura acotada por enum | **N/A** — P1=A (solo lectura); T7 omitida, sin implementación de escritura (verificado) | N/A justificado |
| R13 | `vehiculos.id` uuid PK; Usuario sin `vehiculo_id`; sin FK aquí | `vehiculos.test.ts` (id uuid + Usuario limpio) + `vehiculos-migration.test.ts` (sin FK) | OK |
| R14 | typecheck + lint verdes | ejecutado por el reviewer | OK |
| R15 | backend puro (sin app/ ni components/) | git verificado por el reviewer | OK |

Trazabilidad completa: R1–R11 y R13–R15 cubiertos por tests reales con asserts; R12
correctamente N/A por decisión F1.4 (P1=A) y ausencia efectiva de escritura.

## Coherencia con spec y patrón del repo

- Columna `name` (NO `value`), enum `VehiculoValue`/`@@map("vehiculo_value")`, sin `@map`
  en miembros: OK (schema, migración, seed, tests refuerzan la diferencia deliberada).
- Migración nueva `20260710160000_vehiculos` con timestamp posterior; ninguna previa
  editada; `down.sql` DROP TABLE antes de DROP TYPE; RLS habilitada sin policies: OK.
- Seed idempotente por `name` en `scripts/seed-catalogos.ts`, invocado en `main()`: OK.
- Capas: interfaces en `lib/interfaces/`; service sin HTTP con guard `rol !== "maestro"`
  (patrón `ICobroService`); repository solo Prisma; Server Action usa
  `resolveActorFromSession` y traduce `unauthenticated`. Correcto.
- Sin secretos, sin hardcode de país/moneda, sin PII en logs.

## Hallazgos

### MAYOR (bloqueante)
1. **`specs/50-vehiculos/tasks.md` con las 13 tasks sin marcar (`[ ]`).** CHECKPOINTS
   exige "todas las tasks están marcadas `[x]`". 0/13 marcadas. El trabajo está hecho
   (incluye T0=F1.4, y T7 omitida por P1=A), pero el estado en disco no lo refleja.
   Corrección: marcar T0–T6, T8–T12 como `[x]` y anotar T7 como omitida/N/A.

### menor
2. **Falta entrada en `progress/history.md` para la feature 50.** CHECKPOINTS
   ("Verificación final") la pide; típicamente se añade al cierre/merge por el leader,
   pero hoy no existe. No bloquea el código; registrarla antes de pasar a `done`.

## Checklist CHECKPOINTS
- Spec (requirements/design/tasks) existen; design con alternativas descartadas: OK.
- tasks todas `[x]`: **NO** (hallazgo 1).
- Trazabilidad R→test + mapa en `impl_50-vehiculos.md`: OK.
- typecheck / lint / test: OK (verdes, ejecutados por el reviewer).
- RLS en tabla nueva + migración reversible con `down.sql`: OK.
- Sin secretos hardcodeados: OK.
- Capas (controller/service/repository/interfaces): OK.
- Mutaciones internas por Server Action: OK.
- Sin hardcode multi-país: OK (no aplica).
- `progress/review_50-vehiculos.md` existe: OK (este archivo).
- Entrada en `progress/history.md`: **NO** (hallazgo 2).

## Deuda aceptable (no bloqueante)
- `db:migrate`/`db:seed`/`db:rollback` no aplicados (entorno sin Postgres). Cubierto por
  tests estáticos (regex de migración + fake del seed), como features 4/19. Verificado
  que esos tests existen y son correctos.

Para pasar a APROBADO: resolver el hallazgo MAYOR (marcar tasks.md). El menor (history)
puede cerrarse en el mismo paso.
