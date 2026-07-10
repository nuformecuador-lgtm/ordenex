# Implementación — rol-adminsatelite (feature 19)

Backend. Añade el 5.º rol `adminSatelite` (admin de bodega satélite) al catálogo
`rol_value`, sin otorgar permisos nuevos (autorización defensiva ya cubre el rol
por defecto-`forbidden`). Migración incremental nueva (NO se edita la migración
de login ya aplicada). Decisiones humanas D1-D3 respetadas al pie de la letra.

## Archivos creados/modificados

### Modificados
- `R:\ark-studio\projects\ricardo\ordenex\db\schema.prisma`
  - `enum RolValue`: añadido `adminSatelite` (sin `@map`) tras `adminTienda`,
    conservando los 4 miembros previos y `@@map("rol_value")`.
  - Comentario de `Rol.value` actualizado para reflejar el 5.º valor sembrado
    (documentación, sin efecto de comportamiento).
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\types\roles.test.ts`
  - `ROLES_SEED` ahora se afirma con longitud 5 (antes 4); lista literal
    esperada incluye `adminSatelite`.
  - Nuevo test: `adminSatelite` está en `ROLES_SEED` y
    `RolValue.adminSatelite === "adminSatelite"`.
  - Nuevo test de schema: enum con exactamente 5 miembros (parseo del bloque
    `enum RolValue { ... }`).
  - Nuevo test de schema: `adminSatelite` declarado SIN `@map` (regex negativa
    `adminSatelite\s+@map`).
  - Se mantienen intactas las aserciones de `adminTienda @map("Admin Tienda")`.
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\scripts\seed-catalogos.test.ts`
  - `DB_LABEL` del fake ahora incluye `adminSatelite: "adminSatelite"`
    (identidad, sin `@map`).
  - Aserciones de conteo de filas actualizadas de 4 a 5 (creación, idempotencia,
    `upsert` llamado 5 veces).
  - Nuevo test: el seed persiste una fila con `value = 'adminSatelite'`.

### Creados
- `R:\ark-studio\projects\ricardo\ordenex\db\migrations\20260710130000_rol_admin_satelite\migration.sql`
  — `ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS 'adminSatelite';`
- `R:\ark-studio\projects\ricardo\ordenex\db\migrations\20260710130000_rol_admin_satelite\down.sql`
  — DELETE de la fila de catálogo `'adminSatelite'` → RENAME del tipo actual a
  `rol_value_old` → CREATE TYPE `rol_value` con los 4 labels existentes
  (`'maestro','admin','mensajero','Admin Tienda'`) → ALTER COLUMN por cast de
  texto → DROP TYPE viejo. Orden exacto: DELETE antes del ALTER COLUMN.
- `R:\ark-studio\projects\ricardo\ordenex\tests\integration\db\rol-admin-satelite-migration.test.ts`
  — Lee el DDL de la carpeta `*_rol_admin_satelite` y de `*_login_usuario_rba`
  (sin ejecutar contra DB real): valida `migration.sql` (ALTER TYPE ADD VALUE),
  que la migración de login sigue con 4 labels (no editada), y el contenido +
  orden del `down.sql` (DELETE antes de ALTER COLUMN; RENAME/CREATE TYPE/DROP
  TYPE presentes).
- `R:\ark-studio\projects\ricardo\ordenex\tests\unit\services\rol-admin-satelite-authz.test.ts`
  — Actor `adminSatelite` → `forbidden` en `OrdenService.crear`, `CobroService`
  (lectura `obtener` y escritura `crear`), `AsignacionMensajeroService.listarMensajeros`
  y `BulkOrdenService.cargarMasiva`; y no-regresión: `maestro`/`adminTienda`
  conservan su resultado exitoso en cada servicio.

### Sin cambios (verificado, tal como preveía el spec — T005/T006)
- `lib/types/roles.ts` (`ROLES_SEED = Object.values(RolValue)`): ya deriva del
  enum, expone 5 valores tras `db:generate` sin editar el módulo.
- `scripts/seed-catalogos.ts` (`seedRoles`): itera `ROLES_SEED`, sin lista
  literal; siembra el 5.º rol sin cambios.
- Ningún servicio de autorización tocado (`OrdenService`, `CobroService`,
  `AsignacionMensajeroService`, `BulkOrdenService`): la puerta defensiva por
  defecto-`forbidden` ya cubre `adminSatelite`.
- Migración de login `20260708212416_login_usuario_rba/` intacta (confirmado
  por `git status` sin cambios y por el test de migración nueva).

## Mapa R → test

| Requisito | Test |
|---|---|
| R1 (miembro `adminSatelite` sin `@map`) | `tests/unit/types/roles.test.ts` → "declara adminSatelite SIN @map..." |
| R2 (enum con exactamente 5 miembros) | `tests/unit/types/roles.test.ts` → "declara el enum RolValue con exactamente 5 miembros" y "tiene exactamente los cinco valores del enum..." |
| R3 (migración incremental nueva, login intacta) | `tests/integration/db/rol-admin-satelite-migration.test.ts` → describe "migration.sql (R3)" |
| R4 (down.sql recrea el tipo) | `tests/integration/db/rol-admin-satelite-migration.test.ts` → describe "down.sql (R4, R5)" |
| R5 (DELETE antes del ALTER COLUMN, protección FK) | `tests/integration/db/rol-admin-satelite-migration.test.ts` → "el DELETE ocurre ANTES del ALTER COLUMN" |
| R6 (`ROLES_SEED` deriva del enum, 5 valores) | `tests/unit/types/roles.test.ts` → "se deriva del enum RolValue de Prisma" e "incluye el 5.o rol adminSatelite..." |
| R7 (seed crea fila `adminSatelite`) | `tests/unit/scripts/seed-catalogos.test.ts` → "incluye una fila con value = 'adminSatelite'" |
| R8 (idempotencia, 5 filas, id estable) | `tests/unit/scripts/seed-catalogos.test.ts` → "dos ejecuciones dejan exactamente 5 filas..." |
| R9 (adminSatelite → forbidden en los 4 servicios) | `tests/unit/services/rol-admin-satelite-authz.test.ts` (los 4 describes de "adminSatelite sin permisos nuevos") |
| R10 (no aprobador de mensajeros; restricción no-regresión, feature 22 aún no existe) | Verificado por grep: no existe hoy código de aprobación de postulaciones; sin lista de roles aprobadores que incluya `adminSatelite`. Sin test de código (no aplica hasta feature 22), documentado aquí. |
| R11 (no-regresión roles previos) | `tests/unit/services/rol-admin-satelite-authz.test.ts` (casos "no-regresion" por servicio) + suite completa de `orden-service.test.ts`, `cobro-service.test.ts`, `asignacion-mensajero-service.test.ts`, `bulk-orden-service.test.ts` (sin cambios, siguen en verde) |
| R12 (typecheck verde con el enum de 5 miembros) | `pnpm run typecheck` (ver salida abajo) |

## Salida real de verificación

### `pnpm run typecheck`
```
> ordenex@0.1.0 typecheck
> tsc --noEmit
```
(sin errores, exit 0)

### `pnpm run lint`
```
> ordenex@0.1.0 lint
> eslint
```
(sin errores, exit 0)

### `pnpm test`
```
> ordenex@0.1.0 test
> vitest run

 Test Files  75 passed (75)
      Tests  678 passed (678)
   Start at  03:10:06
   Duration  20.08s
```
Baseline previo: 73 files / 660 tests. Sube a 75 files / 678 tests (2 archivos
nuevos: migración + authz; más aserciones en roles.test.ts y
seed-catalogos.test.ts). Ningún test previo se rompió.

### `./init.sh`
```
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck   (OK)
-> pnpm run lint        (OK)
-> pnpm run test        (75 passed / 678 passed)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```
(`jq` no instalado en el entorno → warning no bloqueante, preexistente)

## Notas / bloqueos

- `pnpm exec prisma validate` y `pnpm run db:generate` corridos: el cliente
  Prisma regenerado expone `RolValue.adminSatelite` (verificado en
  `node_modules/.pnpm/.../\.prisma/client/index.js` y `index.d.ts`).
- T013 (aplicar migración + seed + rollback contra DB real) queda DIFERIDO:
  no hay entorno con DB real disponible en esta sesión (misma limitación que
  login/permissions/role-seed, documentada en tests previos del repo). La
  evidencia sustituta son los tests de DDL (`rol-admin-satelite-migration.test.ts`)
  y de seed (`seed-catalogos.test.ts`).
- R10 no tiene test de código porque el flujo de aprobación de postulaciones
  (feature 22) no existe todavía en el repo; queda como restricción documentada
  para cuando se implemente esa feature.
- No se editó lógica de autorización de ningún servicio, ni la migración de
  login, tal como exigía el encargo.

## Veredicto

Feature 19 (rol-adminsatelite, backend) implementada conforme al spec
aprobado: enum de 5 miembros, migración incremental nueva con down.sql que
recrea el tipo, fuente de verdad TS y seed sin cambios de código, y los 4
servicios de autorización confirmados `forbidden` para `adminSatelite` sin
tocar su código; `typecheck`, `lint`, `test` (678/678) e `init.sh` en verde.
