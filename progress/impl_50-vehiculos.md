# Implementación — vehiculos (feature 50)

> Backend puro. Decisión F1.4: **P1 = Opción A** (catálogo sembrado + SOLO
> LECTURA). Por tanto **T7 omitida** y **R12 N/A** (sin escritura, sin zod de
> escritura, sin `crear/actualizar/borrar`). **P2 = `VehiculoValue`**
> (`@@map("vehiculo_value")`). **P3 = seed en `scripts/seed-catalogos.ts`**.

## Archivos creados

- `db/schema.prisma` — (modificado) enum `VehiculoValue { moto carro camion @@map("vehiculo_value") }`
  + `model Vehiculo { id, name VehiculoValue @unique @@map("vehiculos") }`. Columna
  **`name`** (NO `value`). (T1 · R1, R2, R13)
- `db/migrations/20260710160000_vehiculos/migration.sql` — `CREATE TYPE "vehiculo_value"`,
  `CREATE TABLE "vehiculos"` (id TEXT PK + name), `CREATE UNIQUE INDEX "vehiculos_name_key"`,
  `ENABLE ROW LEVEL SECURITY`. Timestamp posterior al último previo
  (`20260710150000_order_status_value_enum`). (T2 · R3)
- `db/migrations/20260710160000_vehiculos/down.sql` — `DROP TABLE IF EXISTS "vehiculos"`
  antes de `DROP TYPE IF EXISTS "vehiculo_value"`. (T3 · R4, R5)
- `lib/types/vehiculos.ts` — `VEHICULOS_SEED = Object.values(VehiculoValue)` + `VehiculoDTO`. (T4 · R6)
- `scripts/seed-catalogos.ts` — (modificado) `seedVehiculos` (`upsert` por **`name`**) + llamada en `main()`. (T5 · R7, R8)
- `lib/interfaces/services/IVehiculoService.ts` — `Actor`, resultados discriminados
  `ok|forbidden|not_found` (solo lectura). (T6 · R9, R10, R11)
- `lib/interfaces/repositories/IVehiculoRepository.ts` — `findMany`/`findById`. (T6)
- `lib/repositories/VehiculoRepository.ts` — solo Prisma (`findMany` orderBy name, `findUnique`). (T6)
- `lib/services/VehiculoService.ts` — guard `rol !== "maestro" -> forbidden`; `listar`/`obtener`. (T6 · R9, R10, R11)
- `lib/actions/vehiculos.ts` — `'use server'`; `resolveActorFromSession`; sin actor -> `unauthenticated`. (T6 · R10)
- `tests/unit/types/vehiculos.test.ts` — schema (enum/modelo/columna `name`/id uuid/Usuario sin vehiculo_id) + `VEHICULOS_SEED`. (T8)
- `tests/unit/scripts/seed-vehiculos.test.ts` — fake in-memory: persistencia + idempotencia + upsert por `name`. (T8)
- `tests/integration/db/vehiculos-migration.test.ts` — regex sobre `migration.sql`/`down.sql` + no se modificó migración previa. (T9)
- `tests/unit/services/vehiculo-service.test.ts` — matriz de autz (maestro→ok / otros→forbidden / not_found). (T10)
- `tests/integration/actions/vehiculos-action.test.ts` — sin sesión→`unauthenticated`; maestro→delega. (T10)

**Sin archivos nuevos en `app/` ni `components/`** (R15, backend puro). **T7 saltada** (P1=A).

## Mapa R<n> → test

| R | Descripción | Test / verificación |
|---|---|---|
| R1 | enum `VehiculoValue` (3 miembros, sin `@map`, `@@map`) | `tests/unit/types/vehiculos.test.ts` (describe enum) |
| R2 | model `Vehiculo` con columna `name @unique`, `@@map("vehiculos")` | `tests/unit/types/vehiculos.test.ts` (describe modelo) |
| R3 | migration.sql: CREATE TYPE/TABLE/INDEX + RLS; sin editar previas | `tests/integration/db/vehiculos-migration.test.ts` (UP + "no se modificó previa") |
| R4 | down.sql: DROP TABLE antes de DROP TYPE | `tests/integration/db/vehiculos-migration.test.ts` (DOWN) |
| R5 | down seguro (tabla antes que tipo; falla si hubiera FK) | `tests/integration/db/vehiculos-migration.test.ts` (orden DROP + sin FKs) |
| R6 | `VEHICULOS_SEED` deriva del enum, longitud 3 | `tests/unit/types/vehiculos.test.ts` (describe VEHICULOS_SEED) |
| R7 | `seedVehiculos` persiste 3 filas por `name` | `tests/unit/scripts/seed-vehiculos.test.ts` (siembra) |
| R8 | idempotencia: 2 corridas → 3 filas, id estable | `tests/unit/scripts/seed-vehiculos.test.ts` (idempotente) |
| R9 | maestro autorizado (listar/obtener) | `tests/unit/services/vehiculo-service.test.ts` (maestro→ok) |
| R10 | no maestro → forbidden / sin sesión → unauthenticated | `vehiculo-service.test.ts` (forbidden) + `vehiculos-action.test.ts` (unauthenticated) |
| R11 | maestro lista/obtiene las 3 filas con id+name | `vehiculo-service.test.ts` + `vehiculos-action.test.ts` (ok con 3 filas) |
| R12 | escritura acotada | **N/A** — P1=A (solo lectura); T7 omitida, sin implementación de escritura |
| R13 | `vehiculos.id` uuid PK estable; Usuario sin `vehiculo_id` | `tests/unit/types/vehiculos.test.ts` (id uuid + Usuario sin vehiculo_id) + `vehiculos-migration.test.ts` (sin FKs) |
| R14 | typecheck + lint verdes | salida abajo |
| R15 | backend puro (sin app/ ni components/) | verificación: ningún archivo nuevo bajo `app/`/`components/` |

## Salida de verificación

Entorno **sin Postgres** (deuda de despliegue documentada). `db:migrate`/`db:seed`/`db:rollback`
contra Postgres NO se ejecutan aquí; su correctitud se verifica por tests (regex de
migración + fake del seed), como en las features 4/19.

- `prisma generate` (`db:generate`): **OK** — cliente regenerado con `VehiculoValue` y
  `prisma.vehiculo` (`Generated Prisma Client (v7.8.0) ... in 356ms`). El worktree f50 no
  tenía `node_modules`; se ejecutó `npm install` (gestor de la sesión) para poblarlo.
- `npm run typecheck` (`tsc --noEmit`): **VERDE** (EXIT=0).
- `npm run lint` (`eslint`): **VERDE** (0 errores; 135 warnings pre-existentes, todos en
  `.claude/skills/**` y archivos generados — ajenos a esta feature).
- `npm test` (`vitest run`): **VERDE efectivo** — `754 passed`. En la corrida completa
  bajo carga alta, `tests/unit/guards/no-embalaje.test.ts` dio 1 timeout (flaky
  pre-existente, recorre el árbol del repo con 5s de límite); reejecutado aislado pasa en
  495ms (`1 passed`). Los 33 tests nuevos de vehiculos pasan (`33 passed`).

## Deuda / notas

- **Deuda de despliegue:** aplicar `20260710160000_vehiculos` y correr `db:seed` contra
  Postgres real cuando exista DB (misma deuda que features 4/19/18). Verificado estáticamente.
- El worktree f50 se instaló con `npm` (flat `node_modules`), no pnpm; el cliente Prisma se
  generó en `node_modules/@prisma/client`. No afecta al código de la feature.
- `resolveActorFromSession` devuelve `Actor` de `IOrdenService`, estructuralmente compatible
  con el `Actor` de `IVehiculoService` (`{ usuarioId, rol }`).

## Veredicto

Feature 50 (vehiculos) implementada en alcance P1=A (solo lectura sembrada): schema+enum,
migración up/down con RLS, fuente de verdad TS, seed idempotente por `name`, y capa de
lectura autorizada solo-`maestro`. typecheck/lint verdes; 754 tests verdes (1 flaky de
timeout ajeno que pasa aislado). R1–R11, R13–R15 mapeados a test; R12 N/A por decisión F1.4.
