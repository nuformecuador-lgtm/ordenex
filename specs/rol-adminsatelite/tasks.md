# Tasks — rol-adminsatelite (feature 19)

> Backend: `implementer`. `[P]` = paralelizable respecto a otras tareas de su mismo
> bloque de dependencia. Cada task mapea a uno o más `R<n>`. Se crea una migración
> incremental NUEVA (`ALTER TYPE ... ADD VALUE`); NO se edita la migración de login
> ya aplicada. No se toca código de servicios (autorización es defensiva por defecto).

## Bloque 0 — Guardas previas

- [x] T000 [P] Confirmar por grep que NO existe `switch` exhaustivo sobre `RolValue`
  ni `assertNever`/`satisfies never` en `lib/**` (esperado: sin coincidencias). Si
  apareciera alguno sin `default`, registrarlo como sub-tarea para contemplar
  `adminSatelite`. Cubre: R12.
  **Hecho cuando:** grep confirma ausencia (o lista los `switch` a actualizar).
  Depende de: aprobación del spec.

## Bloque 1 — Enum Postgres (schema + migración)

- [x] T001 Añadir en `db/schema.prisma`, dentro de `enum RolValue`, el miembro
  `adminSatelite` **sin `@map`** (label DB = slug `adminSatelite`, [D1]) tras
  `adminTienda`, conservando los 4 previos y `@@map("rol_value")`. Cubre: R1, R2.
  **Hecho cuando:** `npx prisma validate` OK y el enum tiene 5 miembros. Depende de:
  T000.

- [x] T002 Crear la migración incremental nueva
  `db/migrations/<timestamp>_rol_admin_satelite/migration.sql` (timestamp posterior a
  `20260710120000_cobros`) con `ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS
  'adminSatelite';`. NO editar la migración de login. Cubre: R3.
  **Hecho cuando:** existe la carpeta con `migration.sql` conteniendo el `ALTER TYPE
  ... ADD VALUE`, y `git diff` NO toca `20260708212416_login_usuario_rba/`. Depende
  de: T001.

- [x] T003 Crear el `down.sql` de esa migración con el procedimiento de recreación del
  tipo ([D2]): `DELETE FROM "rol" WHERE "value" = 'adminSatelite'` → `ALTER TYPE
  "rol_value" RENAME TO "rol_value_old"` → `CREATE TYPE "rol_value" AS ENUM
  ('maestro','admin','mensajero','Admin Tienda')` → `ALTER TABLE "rol" ALTER COLUMN
  "value" TYPE "rol_value" USING ("value"::text::"rol_value")` → `DROP TYPE
  "rol_value_old"`. Cubre: R4, R5.
  **Hecho cuando:** `down.sql` contiene las 5 sentencias en ese orden (DELETE antes
  del ALTER COLUMN). Depende de: T002.

- [x] T004 Regenerar el cliente Prisma con `pnpm run db:generate` para exponer
  `RolValue.adminSatelite`. Cubre: R1, R6 (habilita la propagación al seed).
  **Hecho cuando:** `pnpm run typecheck` compila y `RolValue.adminSatelite` está
  disponible desde `@prisma/client`. Depende de: T001.

## Bloque 2 — Fuente de verdad TS y seed (sin cambio de código)

- [x] T005 Verificar que `lib/types/roles.ts` (`ROLES_SEED =
  Object.values(RolValue)`) NO requiere cambios y ya expone 5 valores tras T004.
  Cubre: R6.
  **Hecho cuando:** `ROLES_SEED.length === 5` en runtime/test, sin editar el módulo.
  Depende de: T004.

- [x] T006 Verificar que `scripts/seed-catalogos.ts` (`seedRoles` itera `ROLES_SEED`)
  NO requiere cambios y sembrará el 5.º rol. Cubre: R7, R8.
  **Hecho cuando:** revisión confirma que no hay lista literal de roles ni cambios
  necesarios. Depende de: T005.

## Bloque 3 — Tests

- [x] T007 [P] Actualizar/extender `tests/unit/types/roles.test.ts`: `ROLES_SEED`
  longitud 5, incluye `RolValue.adminSatelite`, sigue derivando de
  `Object.values(RolValue)`; y el bloque de schema afirma que el miembro
  `adminSatelite` está declarado **sin `@map`** (p. ej. `adminSatelite` no seguido de
  `@map`, y `RolValue.adminSatelite === "adminSatelite"`) y que el enum tiene 5
  miembros. Cubre: R1, R2, R6.
  **Hecho cuando:** el test verifica longitud 5, presencia de `adminSatelite` y la
  ausencia de `@map` en ese miembro. Depende de: T004.

- [x] T008 [P] Extender `tests/unit/scripts/seed-catalogos.test.ts`: añadir
  `adminSatelite -> 'adminSatelite'` al `DB_LABEL` del fake (identidad, sin `@map`);
  afirmar que `seedRoles` persiste 5 filas incluyendo `value = 'adminSatelite'` y que
  dos corridas dejan 5 filas con `id` estable. Cubre: R7, R8.
  **Hecho cuando:** los tests de creación e idempotencia pasan con 5 roles. Depende
  de: T006.

- [x] T009 [P] Test de la migración nueva (patrón
  `tests/integration/db/role-seed-migration.test.ts`, leyendo el DDL de la carpeta
  `*_rol_admin_satelite`): `migration.sql` contiene `ALTER TYPE "rol_value" ADD VALUE
  IF NOT EXISTS 'adminSatelite'`; y afirmar que la migración de login NO contiene un
  5.º label (no fue editada). Cubre: R3.
  **Hecho cuando:** el test valida el `ALTER TYPE` y que login sigue con 4 labels.
  Depende de: T002.

- [x] T010 [P] Test del `down.sql` nuevo: afirma la presencia y el orden de `DELETE
  FROM "rol" WHERE "value" = 'adminSatelite'`, `RENAME TO "rol_value_old"`, `CREATE
  TYPE "rol_value" AS ENUM ('maestro','admin','mensajero','Admin Tienda')`, `ALTER
  TABLE "rol" ALTER COLUMN "value" TYPE`, `DROP TYPE "rol_value_old"` (DELETE antes
  del ALTER COLUMN). Cubre: R4, R5.
  **Hecho cuando:** el test valida contenido y orden del `down.sql`. Depende de: T003.

- [x] T011 [P] Test de autorización `adminSatelite` (patrón
  `tests/unit/services/*`): `OrdenService.crear`, `CobroService` (una operación de
  lectura y una de escritura), `AsignacionMensajeroService.listarMensajeros` y
  `BulkOrdenService` devuelven `forbidden` para `actor.rol = "adminSatelite"`; y un
  caso de no-regresión (p. ej. `maestro` o `adminTienda` conserva su resultado).
  Cubre: R9, R10, R11.
  **Hecho cuando:** los 4 servicios devuelven `forbidden` para `adminSatelite` y el
  rol previo mantiene su comportamiento. Depende de: T004.

## Bloque 4 — Verificación final

- [x] T012 Correr `pnpm run typecheck`, `pnpm run lint` y `pnpm test` en verde;
  registrar el mapa R1..R12 → test en `progress/impl_rol-adminsatelite.md`. Cubre:
  R12 y trazabilidad completa.
  **Hecho cuando:** todo pasa y el mapa de trazabilidad queda documentado. Depende
  de: T007, T008, T009, T010, T011.

- [~] T013 (DIFERIDO — sin DB real; deuda documentada en progress) Ejecutar `pnpm db:migrate` (aplica la migración nueva) y `pnpm db:seed`
  contra un entorno con DB real; confirmar `SELECT value FROM rol` incluye los 5
  labels (con `'adminSatelite'`) y que una segunda corrida del seed no duplica.
  Verificar `pnpm db:rollback` (aplica `down.sql`: retira la fila y recrea el tipo con
  4 labels). Si no hay DB en el entorno, documentar como DIFERIDO en
  `progress/impl_rol-adminsatelite.md` (misma limitación que login/permissions/role-seed),
  apoyándose en los tests de DDL y de seed. Cubre: R3, R4, R5, R7, R8.
  **Hecho cuando:** migración+seed+rollback corren limpios, o queda documentado el
  diferimiento con evidencia de los tests. Depende de: T012.

## Mapa R → test (resumen de trazabilidad)

- R1, R2 → T007 (schema: `adminSatelite @map`, 5 miembros).
- R3 → T009 (migración `ALTER TYPE ADD VALUE`; login intacta).
- R4, R5 → T010 (`down.sql` recrea el tipo; DELETE previo).
- R6 → T007 (`ROLES_SEED` longitud 5, incluye `adminSatelite`).
- R7, R8 → T008 (seed 5 filas + idempotencia).
- R9, R11 → T011 (`adminSatelite` → forbidden; no-regresión roles previos).
- R10 → T011 / grep (sin lista de aprobadores hoy; restricción para feature 22).
- R12 → T000 + T012 (`typecheck` verde, sin `switch` exhaustivo).
