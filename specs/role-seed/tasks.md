# Tasks — role-seed

> Backend: `implementer`. `[P]` = paralelizable respecto a las tareas de su mismo
> bloque de dependencia. Cada task mapea a uno o más requisitos `R<n>`. Se edita la
> migración de login (aún no aplicada) para introducir un enum de Postgres; NO se
> crea una migración incremental nueva. No se toca `permiso`/`rol_permiso`.

## Bloque 1 — Enum Postgres (schema + migración)

- [x] T001 Declarar en `db/schema.prisma` el `enum RolValue` con los cuatro miembros
  (`maestro`, `admin`, `mensajero`, `adminTienda @map("Admin Tienda")`, `@@map
  ("rol_value")`), siguiendo el patrón de `EstadoUsuario`. Cubre: R1, R2.
  **Hecho cuando:** `prisma validate` (o `npx prisma validate`) no reporta errores
  con el enum declarado. Depende de: aprobación del spec.

- [x] T002 Cambiar `Rol.value` en `db/schema.prisma` de `String @unique` a
  `RolValue @unique`. Cubre: R3.
  **Hecho cuando:** `prisma validate` OK y `Rol.value` es del tipo `RolValue`
  manteniendo la unicidad. Depende de: T001.

- [x] T003 Editar `db/migrations/20260708212416_login_usuario_rba/migration.sql`:
  añadir `CREATE TYPE "rol_value" AS ENUM ('maestro','admin','mensajero','Admin
  Tienda')` antes de la creación de la tabla `rol`, y cambiar la columna `value` de
  `rol` de `TEXT` a `"rol_value"`, conservando el índice único `rol_value_key`.
  Cubre: R4, R5.
  **Hecho cuando:** el `migration.sql` contiene el `CREATE TYPE` antes de `CREATE
  TABLE "rol"`, la columna `value` usa `"rol_value"` y sigue el `CREATE UNIQUE INDEX
  "rol_value_key"`. Depende de: T002.

- [x] T004 Editar `db/migrations/20260708212416_login_usuario_rba/down.sql`: añadir
  `DROP TYPE IF EXISTS "rol_value"` junto al `DROP TYPE` de `estado_usuario`, en
  orden correcto (después del `DROP TABLE ... "rol"`). Cubre: R6.
  **Hecho cuando:** `down.sql` contiene `DROP TYPE IF EXISTS "rol_value"` tras la
  eliminación de la tabla `rol`. Depende de: T003.

- [x] T005 Regenerar el cliente Prisma con `pnpm run db:generate` para exponer el
  enum `RolValue`. Cubre: R2, R3 (habilita el uso tipado del enum).
  **Hecho cuando:** `pnpm run typecheck` compila y `RolValue` está disponible desde
  `@prisma/client`. Depende de: T002.

## Bloque 2 — Fuente de verdad TS y seed

- [x] T006 Crear el módulo `lib/types/roles.ts` que derive `ROLES_SEED` del enum
  `RolValue` de Prisma (fuente única de verdad; incluye los 4 valores, NO
  `'usuario'`). Cubre: R7, R11.
  **Hecho cuando:** el módulo exporta `ROLES_SEED` con los 4 labels exactos, sin
  `'usuario'`; `pnpm run typecheck` compila. Depende de: T005.

- [x] T007 Modificar `scripts/seed-catalogos.ts` para importar `ROLES_SEED` e iterar
  sobre él en el upsert por `value`, eliminando la lista literal `["admin",
  "usuario"]` (deja de sembrar `'usuario'`). Mantener el upsert `{ where: { value },
  update: {}, create: { value } }` sin `delete` ni transformación de strings.
  Cubre: R8, R9, R10, R11, R12.
  **Hecho cuando:** el seed itera `ROLES_SEED`, no referencia `'usuario'`, no
  contiene borrados; `pnpm run typecheck` compila. Depende de: T006.

- [x] T008 Confirmar que `package.json` mantiene `"db:seed": "tsx
  scripts/seed-catalogos.ts"` (no requiere cambio; verificación explícita). Cubre:
  R13.
  **Hecho cuando:** `pnpm db:seed` invoca el script modificado. Depende de: T007.

## Bloque 3 — Tests

- [x] T009 [P] Test de la migración (enum): afirmar que `migration.sql` de login
  contiene `CREATE TYPE "rol_value" AS ENUM ('maestro','admin','mensajero','Admin
  Tienda')` antes de `CREATE TABLE "rol"`, que la columna `value` de `rol` es
  `"rol_value"` y persiste el índice único `rol_value_key`. Cubre: R1, R4, R5.
  **Hecho cuando:** el test valida el contenido/orden del DDL. Depende de: T003.

- [x] T010 [P] Test del down.sql: afirmar que
  `db/migrations/20260708212416_login_usuario_rba/down.sql` contiene `DROP TYPE IF
  EXISTS "rol_value"` tras el `DROP TABLE ... "rol"`. Cubre: R6.
  **Hecho cuando:** el test valida presencia y orden del `DROP TYPE`. Depende de:
  T004.

- [x] T011 [P] Test del schema/enum: afirmar (vía `prisma validate` y/o inspección)
  que `db/schema.prisma` declara `enum RolValue` con `@map("Admin Tienda")` y que
  `Rol.value` es `RolValue @unique`. Cubre: R2, R3.
  **Hecho cuando:** `prisma validate` pasa y el test confirma la declaración.
  Depende de: T002.

- [x] T012 [P] Test de la fuente de verdad: afirmar que `ROLES_SEED` contiene
  exactamente `maestro`, `admin`, `mensajero`, `Admin Tienda` (grafías exactas) y NO
  contiene `'usuario'`. Cubre: R7, R11.
  **Hecho cuando:** el test verifica longitud 4, valores exactos y ausencia de
  `'usuario'`. Depende de: T006.

- [x] T013 [P] Test "el seed crea los cuatro roles": ejecutar el seed sobre una DB
  de test limpia y verificar una fila por cada `value` del enum, con grafía exacta.
  Cubre: R8.
  **Hecho cuando:** el test lee `rol` por cada `value` y afirma existencia/grafía.
  Depende de: T007.

- [x] T014 [P] Test de idempotencia: ejecutar el seed dos veces seguidas y afirmar
  `count` de filas con los cuatro `value` = 4, sin duplicados y con `id` estable.
  Cubre: R9, R10.
  **Hecho cuando:** 4 filas tras la segunda corrida, sin error de unicidad, `id`
  estable. Depende de: T007.

- [x] T015 [P] Test "el seed NO crea `usuario`": ejecutar el seed sobre DB limpia y
  afirmar `count(*) FROM rol WHERE value = 'usuario' = 0`. Cubre: R11.
  **Hecho cuando:** el test confirma que no existe rol `'usuario'` tras el seed.
  Depende de: T007.

- [x] T016 [P] Test de aislamiento: capturar `count` de `usuario`,
  `tipo_identificacion`, `permiso` y `rol_permiso` antes/después del seed y afirmar
  que no cambian. Cubre: R12.
  **Hecho cuando:** los `count` de esas tablas son iguales antes y después. Depende
  de: T007.

- [x] T017 [P] Test de fallo "sale con código ≠ 0": forzar un fallo de upsert (p. ej.
  cliente Prisma sin conexión) y afirmar exit code ≠ 0 con log de error. Cubre: R14.
  **Hecho cuando:** el test observa `process.exit(1)`/rechazo propagado con log.
  DIFERIBLE si no hay DB real; documentar en `progress/impl_role-seed.md`. Depende
  de: T007.

## Bloque 4 — Verificación final

- [x] T018 Correr `pnpm run typecheck`, `pnpm run lint` y `pnpm test` en verde;
  registrar el mapa R1..R14 → test en `progress/impl_role-seed.md`. Cubre: R13
  (comando de seed documentado y verificado).
  **Hecho cuando:** todo pasa y el mapa de trazabilidad queda documentado. Depende
  de: T009, T010, T011, T012, T013, T014, T015, T016, T017.

- [x] T019 Ejecutar `pnpm db:migrate` y `pnpm db:seed` contra un entorno con DB real
  y confirmar los cuatro `value` en `rol` (con el tipo enum) y la ausencia de
  `'usuario'`; verificar `pnpm db:rollback` (aplica `down.sql`, DROP TYPE incluido).
  Si no hay DB en el entorno, documentar como DIFERIDO en
  `progress/impl_role-seed.md` (misma limitación que login/permissions). Cubre:
  R4, R5, R6, R8-R11, R13.
  **Hecho cuando:** migración+seed corren limpios con el enum y los cuatro roles sin
  `'usuario'`, o queda documentado el diferimiento con la evidencia de los tests de
  DDL y de seed. Depende de: T008, T018.
