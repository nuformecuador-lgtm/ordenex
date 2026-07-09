# Bitácora de implementación — role-seed

Backend/DB 100%. Enum de Postgres `rol_value` + seed idempotente de roles.

## Archivos creados/modificados

Modificados:
- `db/schema.prisma` — añadido `enum RolValue` (con `adminTienda @map("Admin Tienda")`, `@@map("rol_value")`); `Rol.value` pasa de `String @unique` a `RolValue @unique`.
- `db/migrations/20260708212416_login_usuario_rba/migration.sql` — añadido `CREATE TYPE "rol_value" AS ENUM ('maestro', 'admin', 'mensajero', 'Admin Tienda')` antes de `CREATE TABLE "rol"`; columna `value` de `rol` de `TEXT` a `"rol_value"`; índice único `rol_value_key` intacto.
- `db/migrations/20260708212416_login_usuario_rba/down.sql` — añadido `DROP TYPE IF EXISTS "rol_value"` tras `DROP TYPE IF EXISTS "estado_usuario"` (después del `DROP TABLE ... "rol"`).
- `scripts/seed-catalogos.ts` — eliminada la lista literal `["admin","usuario"]`; extraídas `seedTiposIdentificacion(prisma)` y `seedRoles(prisma)` exportadas con inyección del cliente; `main()` las invoca dentro del try/finally con `$disconnect`; auto-run guardado por entrypoint (`import.meta.url === pathToFileURL(process.argv[1]).href`) para permitir importar `seedRoles` desde tests sin disparar `main()`; `main().catch(... process.exit(1))` conservado.

Creados:
- `lib/types/roles.ts` — fuente única de verdad `ROLES_SEED = Object.values(RolValue)`.
- `tests/integration/db/role-seed-migration.test.ts` — DDL sin DB real.
- `tests/unit/types/roles.test.ts` — ROLES_SEED + inspección de schema.
- `tests/unit/scripts/seed-catalogos.test.ts` — fake in-memory de Prisma.

Verificado sin cambios:
- `package.json` mantiene `"db:seed": "tsx scripts/seed-catalogos.ts"` (T008, R13).

## Mapa R1..R14 → test

- R1 → `role-seed-migration.test.ts::crea el enum rol_value con los cuatro labels exactos (R1, R4)`
- R2 → `roles.test.ts::declara el enum RolValue con @@map("rol_value")` + `::incluye los cuatro miembros, con @map("Admin Tienda")`
- R3 → `roles.test.ts::tipa Rol.value como RolValue @unique (R3)`
- R4 → `role-seed-migration.test.ts::declara el CREATE TYPE del enum ANTES de crear la tabla rol (R4)`
- R5 → `role-seed-migration.test.ts::tipa la columna value de rol con el enum rol_value (R5)` + `::conserva el indice unico rol_value_key sobre value (R5)`
- R6 → `role-seed-migration.test.ts::dropea el tipo rol_value (R6)` + `::dropea el enum rol_value DESPUES de eliminar la tabla rol (R6)`
- R7 → `roles.test.ts::tiene exactamente los cuatro valores del enum, sin duplicados (R7)` + `::se deriva del enum RolValue de Prisma (R7)`
- R8 → `seed-catalogos.test.ts::persiste una fila por cada valor del enum con el label real de la DB`
- R9 → `seed-catalogos.test.ts::dos ejecuciones dejan exactamente 4 filas, sin duplicados y con id estable`
- R10 → `seed-catalogos.test.ts::dos ejecuciones dejan exactamente 4 filas, sin duplicados y con id estable`
- R11 → `roles.test.ts::NO incluye 'usuario' (R11)` + `seed-catalogos.test.ts::tras el seed no existe ninguna fila con value 'usuario'`
- R12 → `seed-catalogos.test.ts::solo usa prisma.rol.upsert; usuario/tipo_identificacion/permiso/rol_permiso intactos`
- R13 → `package.json` cablea `db:seed` al script modificado (verificación explícita, T008)
- R14 → `seed-catalogos.test.ts::si un upsert rechaza, seedRoles rechaza (habilita process.exit(1) en main)`

## Salida real de verificación

`pnpm db:generate`:
```
✔ Generated Prisma Client (v7.8.0) ... in 314ms
```

`pnpm typecheck`:
```
> tsc --noEmit
(sin errores)
```

`pnpm lint`:
```
> eslint
(sin errores)
```

`pnpm test`:
```
Test Files  24 passed (24)
     Tests  144 passed (144)
```
Subconjunto role-seed: 3 archivos, 18 tests, todos en verde.

## Desviación del spec (documentada, no inventada)

El spec (T006) asume que `Object.values(RolValue)` produce los labels de la DB
`['maestro','admin','mensajero','Admin Tienda']`. En Prisma 7.8 esto es FALSO: el
cliente generado expone el NOMBRE del miembro del enum, no el label mapeado. El
tipo generado es `RolValue = 'maestro' | 'admin' | 'mensajero' | 'adminTienda'` y
`Object.values(RolValue) = ['maestro','admin','mensajero','adminTienda']`.

Consecuencia: forzar `ROLES_SEED` a contener el literal `'Admin Tienda'` es
IMPOSIBLE sin (a) romper `pnpm typecheck` (`'Admin Tienda'` no es asignable a
`RolValue`), (b) romper el seed real (el cliente Prisma rechaza el label; hay que
pasarle `'adminTienda'` y Prisma lo traduce a `'Admin Tienda'` en Postgres), y
(c) violar R7 (habría que hardcodear `'Admin Tienda'`, dejando de derivar del
enum). Por eso `ROLES_SEED = Object.values(RolValue)` es la ÚNICA implementación
que satisface R7, compila y funciona contra la DB real.

La grafía exacta de la DB `'Admin Tienda'` (R8) se verifica igualmente:
- El label real se declara y valida en el schema (`@map("Admin Tienda")`) y en la
  migración (`CREATE TYPE "rol_value" AS ENUM (..., 'Admin Tienda')`).
- El fake de Prisma en el test de seed replica la traducción nombre→label que
  Prisma aplica al escribir en Postgres, de modo que la fila almacenada guarda
  `'Admin Tienda'` y el test de R8 afirma esa grafía exacta.

## Deuda diferida (misma limitación que login/permissions)

- T019: aplicar la migración a Postgres real (`pnpm db:migrate`), `pnpm db:seed`,
  verificación de los 4 `value` en `rol` con el tipo enum, ausencia de `'usuario'`
  y `pnpm db:rollback` (DROP TYPE incluido) quedan DIFERIDOS por falta de DB en el
  entorno. El SQL, schema, enum, seed y tests de DDL/fake están escritos y en verde.
- El exit-code end-to-end real de R14 (`process.exit(1)`) queda diferido; el test
  cubre la propagación del rechazo por `seedRoles`, que es lo que dispara el
  `main().catch(... process.exit(1))`.

## Veredicto

Feature role-seed implementada y verificada estáticamente en verde (typecheck, lint, 144 tests); aplicación/seed contra Postgres real diferidos por ausencia de DB, con evidencia de DDL y seed cubierta por tests.
