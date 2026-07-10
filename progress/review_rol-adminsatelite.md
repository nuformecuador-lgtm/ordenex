# Review — rol-adminsatelite (feature 19)

Reviewer (arnes SDD). Branch: `feature/19-rol-adminsatelite`. Fecha: 2026-07-10.

## Veredicto: APROBADO (0 bloqueantes)

## Checklist CHECKPOINTS.md

- [x] `specs/rol-adminsatelite/requirements.md` con EARS numerados R1..R12 + decisiones cerradas D1-D3.
- [x] `design.md` con alternativas descartadas (4 descartes documentados).
- [x] `tasks.md` con todas las tasks `[x]` (T013 marcada `[~]` DIFERIDO, sin DB real, deuda documentada — coherente con patron login/permissions/role-seed).
- [x] Cada R<n> mapea a test concreto (ver tabla).
- [x] `progress/impl_rol-adminsatelite.md` contiene el mapa R -> test.
- [x] `pnpm run typecheck` OK (verificado por mi via `./init.sh`).
- [x] `pnpm run lint` OK.
- [x] `pnpm test` OK: 75 files / 678 tests passed (baseline dev 73/660 -> 75/678, sin regresiones).
- [x] Migracion nueva tiene `down.sql`; `./init.sh` valida presencia de down.sql en todas.
- [x] Sin secretos hardcodeados.
- [x] Sin hardcode de pais/moneda/cuenta (no aplica; feature de catalogo de roles).
- [x] `./init.sh` en verde.

## Decisiones humanas cerradas — verificadas

- [x] **D1 (enum sin @map):** `db/schema.prisma` L35-43 declara `enum RolValue` con 5 miembros; `adminSatelite` sin `@map`; `adminTienda @map("Admin Tienda")` intacto; `@@map("rol_value")` presente.
- [x] **D2 (migracion incremental nueva):** `db/migrations/20260710130000_rol_admin_satelite/migration.sql` = `ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS 'adminSatelite';`. La migracion de login `20260708212416_login_usuario_rba/migration.sql` NO fue modificada (no aparece en `git diff --name-only origin/dev`; sigue con `CREATE TYPE "rol_value" AS ENUM ('maestro','admin','mensajero','Admin Tienda')`, sin 'adminSatelite').
- [x] **D2 (down.sql):** DELETE de la fila 'adminSatelite' -> RENAME a `rol_value_old` -> CREATE TYPE con los 4 labels reales -> ALTER COLUMN por cast -> DROP TYPE viejo. Nombre de tipo (`rol_value`) y columna (`rol.value`, unica que usa el tipo) coherentes con el schema. DELETE antes del ALTER COLUMN (protege FK `usuario_rol_id_fkey`, R5).
- [x] **D3 (sin permisos nuevos):** El diff NO toca `OrdenService`, `CobroService`, `AsignacionMensajeroService` ni `BulkOrdenService`; el test authz confirma `forbidden` para `adminSatelite` en las 4 puertas.

## Tabla de trazabilidad R1..R12 -> test

| R | Que verifica | Test | Estado |
|---|---|---|---|
| R1 | miembro `adminSatelite` sin `@map` | `tests/unit/types/roles.test.ts` ("declara adminSatelite SIN @map"; `RolValue.adminSatelite === "adminSatelite"`) | OK |
| R2 | enum con exactamente 5 miembros | `tests/unit/types/roles.test.ts` ("exactamente 5 miembros"; `ROLES_SEED.length===5`) | OK |
| R3 | migracion incremental nueva; login intacta | `tests/integration/db/rol-admin-satelite-migration.test.ts` (ALTER TYPE ADD VALUE; login sin 'adminSatelite') | OK |
| R4 | down.sql recrea el tipo | mismo archivo (RENAME/CREATE TYPE 4 labels/ALTER COLUMN/DROP TYPE) | OK |
| R5 | DELETE antes de ALTER COLUMN (proteccion FK) | mismo archivo ("el DELETE ocurre ANTES del ALTER COLUMN") | OK |
| R6 | ROLES_SEED deriva del enum (5 valores) | `tests/unit/types/roles.test.ts` ("se deriva del enum RolValue"; `sort()` igual a `Object.values`) | OK |
| R7 | seed crea fila 'adminSatelite' | `tests/unit/scripts/seed-catalogos.test.ts` ("incluye una fila con value = 'adminSatelite'") | OK |
| R8 | idempotencia, 5 filas, id estable | `tests/unit/scripts/seed-catalogos.test.ts` ("dos ejecuciones dejan 5 filas... id estable") | OK |
| R9 | adminSatelite -> forbidden en 4 servicios | `tests/unit/services/rol-admin-satelite-authz.test.ts` (Orden/Cobro read+write/AsignacionMensajero/Bulk) | OK |
| R10 | adminSatelite NO aprueba postulaciones | Restriccion de no-regresion (feature 22 aun no existe). Grep en `lib/` de `aprob|approv|postulaci` = 0 coincidencias. Sin codigo que testear hoy. | OK (documentado) |
| R11 | no-regresion de los 4 roles previos | `tests/unit/services/rol-admin-satelite-authz.test.ts` (casos "no-regresion" maestro/adminTienda) + suites existentes intactas | OK |
| R12 | typecheck verde con enum de 5 | `pnpm run typecheck` via `./init.sh` (exit 0); T000 confirmo sin `switch` exhaustivo/`assertNever` | OK |

## Verificaciones adicionales

- **Diff acotado:** `git diff --name-only origin/dev` = `db/schema.prisma`, `feature_list.json`, `progress/current.md`, `progress/history.md`, `tests/unit/scripts/seed-catalogos.test.ts`, `tests/unit/types/roles.test.ts`. Untracked: carpeta de migracion nueva, `tests/integration/db/rol-admin-satelite-migration.test.ts`, `tests/unit/services/rol-admin-satelite-authz.test.ts`, `specs/rol-adminsatelite/`, `progress/impl_rol-adminsatelite.md`. NO se toca la migracion de login ni la logica de autorizacion de servicios ni `lib/types/roles.ts` ni `scripts/seed-catalogos.ts` (fuente de verdad y seed siguen derivando del enum, sin lista literal).
- **No-regresion:** suites previas de roles/servicios siguen en verde (678/678). Ningun test previo roto.

## Salida real de `./init.sh`

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck    (OK, exit 0)
-> pnpm run lint         (OK, exit 0)
-> pnpm run test
 Test Files  75 passed (75)
      Tests  678 passed (678)
   Duration  19.27s
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

(warning de `jq` es preexistente y no bloqueante).

## Hallazgos

### Bloqueantes
Ninguno.

### Menores
- **[menor] T013 diferido:** la aplicacion real de `ALTER TYPE` + seed + rollback contra Postgres queda como deuda documentada (sin DB en el entorno), igual patron que login/permissions/role-seed. Lo verificable sin DB (contenido/orden del DDL, seed via fake in-memory, authz, typecheck) esta cubierto. Aceptable; recomendado ejecutar la verificacion en caliente al desplegar.
- **[menor] R10 sin test de codigo:** correcto porque el flujo de aprobacion (feature 22) no existe todavia. Grep confirma ausencia de lista de aprobadores. Queda como restriccion para feature 22; el reviewer de esa feature debe validar la exclusion explicita de `adminSatelite`.

## Veredicto final: APROBADO
No hay bloqueantes. Feature 19 cumple el spec aprobado, decisiones D1-D3, trazabilidad R1..R12 e `./init.sh` en verde.
