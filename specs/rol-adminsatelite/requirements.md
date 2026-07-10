# Requisitos — rol-adminsatelite (feature 19)

> Alcance: añadir un quinto rol `adminSatelite` ("admin de bodega satelite") al
> catálogo. El catálogo pasa de 4 a 5 valores: `maestro`, `admin`, `mensajero`,
> `adminTienda`, `adminSatelite`. Se toca: (a) el enum de Postgres `rol_value`
> (miembro TS/Prisma + migración incremental), (b) la fuente única de verdad en TS
> (`lib/types/roles.ts` → `ROLES_SEED`), (c) el seed idempotente de roles
> (`seedRoles`). NO crea tablas, endpoints ni UI. NO otorga permisos nuevos a
> `adminSatelite`. Sigue el patrón de la feature 4 (`specs/role-seed/`), con una
> diferencia CRÍTICA: la migración de login `20260708212416_login_usuario_rba`
> **ya está aplicada** (feature 4 mergeada + 5 migraciones posteriores), por lo que
> aquí NO se edita esa migración: se crea una **migración incremental nueva** con
> `ALTER TYPE`.

## Contexto verificado del repo (no inventado)

- `db/schema.prisma` (líneas 35-42): `enum RolValue { maestro admin mensajero
  adminTienda @map("Admin Tienda") @@map("rol_value") }`. El miembro con label no
  identificador se declara con `@map`.
- `lib/types/roles.ts`: `export const ROLES_SEED: RolValue[] =
  Object.values(RolValue)`. Añadir un miembro al enum lo propaga al seed
  automáticamente (sin lista literal).
- `scripts/seed-catalogos.ts` `seedRoles(prisma)`: itera `ROLES_SEED` con
  `upsert({ where: { value }, update: {}, create: { value } })` (idempotente por el
  índice único `rol_value_key`).
- El enum `rol_value` se creó con `CREATE TYPE "rol_value" AS ENUM
  ('maestro','admin','mensajero','Admin Tienda')` en la migración de login
  (`db/migrations/20260708212416_login_usuario_rba/migration.sql`, línea 5), **ya
  aplicada** (existen migraciones posteriores: permissions, seed_maestro_user,
  ordenes, cobros, carga_masiva). Por eso el cambio de enum va en una migración
  incremental nueva, no editando la de login.
- Autorización por rol en servicios (verificado): todas las puertas son
  **defensivas por defecto-`forbidden`**, no hay `switch` exhaustivo sobre
  `RolValue` ni `assertNever`:
  - `OrdenService` (línea 21/28): `KNOWN_ROLES = {maestro, admin, adminTienda,
    mensajero}`; `if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }`.
  - `CobroService` (líneas 16-17): `READ_ROLES = {maestro, admin}`,
    `WRITE_ROLES = {maestro}`; el resto sin acceso.
  - `AsignacionMensajeroService` (línea 26): `if (rol !== "adminTienda" && rol !==
    "maestro" && rol !== "admin") forbidden`.
  - `BulkOrdenService` (línea 166): `if (actor.rol !== "adminTienda") forbidden`.

## Enum y schema

- **R1 (ubicuo):** El sistema DEBE declarar en `db/schema.prisma`, dentro del `enum
  RolValue`, un quinto miembro `adminSatelite` **sin `@map`** (el label de la DB es el
  slug camelCase `adminSatelite`, decisión humana 2026-07-10), conservando los cuatro
  miembros existentes (incluido `adminTienda @map("Admin Tienda")`) y el
  `@@map("rol_value")`. A diferencia de `adminTienda`, `adminSatelite` NO lleva `@map`
  porque el nombre del miembro ya es un identificador válido igual al label deseado.
- **R2 (ubicuo):** El sistema DEBE mantener el enum `RolValue` con exactamente cinco
  miembros tras el cambio: `maestro`, `admin`, `mensajero`, `adminTienda`,
  `adminSatelite` (sin duplicados, sin retirar ninguno de los cuatro previos).

## Migración incremental (nueva, no editar la de login)

- **R3 (ubicuo):** El sistema DEBE crear una **migración incremental nueva** (carpeta
  propia bajo `db/migrations/`, p. ej. `<timestamp>_rol_admin_satelite/`) que añada
  el label slug `'adminSatelite'` al tipo `rol_value` con `ALTER TYPE "rol_value" ADD
  VALUE IF NOT EXISTS 'adminSatelite'`. El sistema NO DEBE editar la migración de
  login ya aplicada (`20260708212416_login_usuario_rba`).
- **R4 (ubicuo):** El sistema DEBE proveer el `down.sql` de esa migración que revierta
  la adición del label. Dado que Postgres NO soporta quitar un valor de un enum
  (`DROP VALUE` no existe), el `down.sql` DEBE recrear el tipo sin `'adminSatelite'`
  conservando los cuatro labels EXISTENTES tal cual están en la DB (renombrar el tipo
  actual a `*_old`, `CREATE TYPE "rol_value" AS ENUM
  ('maestro','admin','mensajero','Admin Tienda')` — nótese que `adminTienda` mantiene
  su label `'Admin Tienda'`; solo se excluye `'adminSatelite'`—, migrar la columna
  `rol.value` al nuevo tipo por cast de texto, `DROP TYPE` del viejo), previa retirada
  de la fila de catálogo `rol` con `value = 'adminSatelite'` (decisión humana
  2026-07-10: down recrea el tipo, no no-op).
- **R5 (condicional):** SI el `down.sql` se ejecuta MIENTRAS alguna fila de `usuario`
  referencia (vía `rol_id`) el rol `'adminSatelite'`, ENTONCES el sistema NO DEBE
  ejecutar un borrado que viole la FK `usuario_rol_id_fkey`; el `down.sql` DEBE
  fallar de forma explícita (no dejar estado inconsistente). Precondición esperada:
  `adminSatelite` es nuevo y ningún usuario lo referencia (rollback seguro).

## Fuente única de verdad en TS y seed

- **R6 (ubicuo):** El sistema DEBE mantener `lib/types/roles.ts` derivando `ROLES_SEED`
  del enum `RolValue` de Prisma (sin lista literal duplicada), de modo que tras
  regenerar el cliente Prisma `ROLES_SEED` contenga exactamente los cinco valores del
  enum, incluido `adminSatelite`.
- **R7 (por evento):** CUANDO `seedRoles` se ejecuta, el sistema DEBE garantizar una
  fila en `rol` por cada uno de los cinco valores del enum, incluida una con el label
  de la DB `'adminSatelite'` (slug camelCase exacto, sin espacio ni `@map`; decisión
  humana 2026-07-10).
- **R8 (por evento):** CUANDO `seedRoles` se ejecuta dos o más veces consecutivas
  sobre la misma base, el sistema DEBE dejar exactamente una fila por cada valor del
  enum (cinco en total), sin duplicados y con `id` estable, conservando el
  comportamiento idempotente actual (`upsert` por `value`, `update: {}` no-op, sin
  `delete`).

## Autorización de adminSatelite

- **R9 (ubicuo):** El sistema DEBE tratar a `adminSatelite` como rol **sin permisos
  nuevos**: en toda puerta de autorización por rol existente (`OrdenService`,
  `CobroService`, `AsignacionMensajeroService`, `BulkOrdenService`), un actor con
  `rol = adminSatelite` DEBE recibir `forbidden` allí donde el rol no esté en la lista
  de permitidos (comportamiento por defecto-`forbidden` ya presente; sin cambios de
  código de servicio).
- **R10 (ubicuo):** El sistema NO DEBE otorgar a `adminSatelite` la capacidad de
  aprobar postulaciones de mensajeros; esa capacidad queda limitada a `maestro`/`admin`
  (feature 22). Como el flujo de aprobación aún no existe en el código, este requisito
  es una **restricción de no-regresión**: cuando se implemente la feature 22, la lista
  de roles aprobadores NO debe incluir `adminSatelite`.

## No-regresión y typecheck

- **R11 (ubicuo):** El sistema DEBE conservar intacto el comportamiento de los cuatro
  roles previos (`maestro`, `admin`, `mensajero`, `adminTienda`) en todos los
  servicios: sus permisos actuales no cambian al añadir `adminSatelite`.
- **R12 (ubicuo):** El sistema DEBE compilar (`pnpm run typecheck`) tras añadir el
  miembro al enum: dado que no existe ningún `switch` exhaustivo sobre `RolValue` ni
  `assertNever` (verificado), añadir el miembro NO DEBE romper el typecheck. SI una
  verificación posterior encontrara un `switch`/matriz exhaustiva sin `default`,
  ENTONCES DEBE actualizarse para contemplar `adminSatelite` (ver tarea T0-guard).

## Criterios de aceptación (verificables)

- `db/schema.prisma` contiene el miembro `adminSatelite` (sin `@map`) dentro de
  `enum RolValue` y el enum tiene 5 miembros (R1, R2).
- Existe una migración nueva cuyo `migration.sql` contiene `ALTER TYPE "rol_value"
  ADD VALUE IF NOT EXISTS 'adminSatelite'`; la migración de login NO fue modificada
  (R3).
- El `down.sql` de la migración nueva recrea `rol_value` sin `'adminSatelite'`
  (RENAME a `*_old`, CREATE TYPE con los 4 labels existentes
  `'maestro','admin','mensajero','Admin Tienda'`, ALTER COLUMN por cast, DROP TYPE
  viejo) y retira la fila `rol` `'adminSatelite'` antes (R4, R5).
- Tras `pnpm run db:generate`, `ROLES_SEED` tiene longitud 5 e incluye
  `RolValue.adminSatelite` (R6).
- El fake de `seedRoles` persiste 5 filas, una con `value = 'adminSatelite'` (R7);
  dos ejecuciones dejan 5 filas con `id` estable (R8).
- `OrdenService.crear`, `CobroService` (lectura y escritura),
  `AsignacionMensajeroService.listarMensajeros` y `BulkOrdenService` devuelven
  `forbidden` para un actor `adminSatelite` (R9, R11).
- No existe (grep) ninguna lista de roles aprobadores que incluya `adminSatelite`;
  cuando exista la feature 22, la exclusión se testea allí (R10).
- `pnpm run typecheck` compila con el enum de 5 miembros (R12).

## Decisiones cerradas (humano, 2026-07-10)

- **[D1] Label de la DB para `adminSatelite` = slug `'adminSatelite'` SIN `@map`.** El
  miembro del enum es `adminSatelite` y el label en la base de datos es exactamente
  `adminSatelite` (camelCase). En `db/schema.prisma` el miembro va **a secas**, sin
  `@map` (a diferencia de `adminTienda @map("Admin Tienda")`). La migración UP añade el
  label `'adminSatelite'`; la fila de catálogo `rol` tendrá `value = 'adminSatelite'`.
- **[D2] `down.sql` RECREA el tipo** sin el valor (procedimiento de R4: rename a
  `*_old`, `CREATE TYPE` con los 4 labels existentes, `ALTER COLUMN` por cast de texto,
  `DROP TYPE` viejo, previo borrado de la fila de catálogo `'adminSatelite'`). NO se usa
  la opción no-op.
- **[D3] Postgres 15+ (Supabase).** `ALTER TYPE ... ADD VALUE` es compatible con la
  ejecución transaccional de Prisma Migrate porque esta migración solo añade el label,
  no lo usa en la misma migración. Sin cambios extra (no requiere migración no
  transaccional).
