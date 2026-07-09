# Requisitos — role-seed

> Alcance: (a) convertir el catálogo de roles en un enum de POSTGRES declarado en la
> migración de login (aún no aplicada) y en `db/schema.prisma`, y (b) poblar la tabla
> `rol` con los cuatro valores del enum mediante un seed idempotente. NO crea tablas
> nuevas, ni UI, ni endpoints, ni toca `permiso`/`rol_permiso`. La migración de login
> todavía NO se aplicó, por lo que se EDITA esa migración en lugar de crear una nueva
> incremental con `ALTER`.

## Enum Postgres y schema

- **R1 (ubicuo):** El sistema DEBE definir un enum de Postgres (p. ej. `rol_value`)
  con exactamente cuatro labels: `'maestro'`, `'admin'`, `'mensajero'` y
  `'Admin Tienda'` (labels exactos: `'mensajero'` con `j`; `'Admin Tienda'` con `A`
  y `T` mayúsculas y un espacio intermedio).
- **R2 (ubicuo):** El sistema DEBE declarar ese enum en `db/schema.prisma` siguiendo
  el patrón del enum preexistente `EstadoUsuario` (miembros del enum con `@map` para
  el label que no sea identificador válido, `@@map` al nombre del tipo en la DB).
- **R3 (ubicuo):** El sistema DEBE tipar la columna `value` del modelo `Rol` con ese
  enum (deja de ser `String`), conservando su restricción de unicidad
  (`@unique` / índice único `rol_value_key`).

## Migración (editar la de login, no crear nueva)

- **R4 (ubicuo):** El sistema DEBE crear el tipo enum con `CREATE TYPE ... AS ENUM`
  en el `migration.sql` de la migración de login
  (`db/migrations/20260708212416_login_usuario_rba/`) ANTES de que la tabla `rol`
  use ese tipo.
- **R5 (ubicuo):** El sistema DEBE definir la columna `value` de la tabla `rol` con
  el tipo enum en ese mismo `migration.sql`, manteniendo el índice único
  `rol_value_key` sobre `value`.
- **R6 (ubicuo):** El sistema DEBE actualizar el `down.sql` de esa migración para
  revertir el cambio con `DROP TYPE IF EXISTS` del enum de rol, coherente con el
  `DROP TYPE IF EXISTS "estado_usuario"` ya presente y en orden correcto (después de
  eliminar la tabla `rol` que usa el tipo).

## Fuente única de verdad en TS

- **R7 (ubicuo):** El sistema DEBE mantener una fuente única de verdad en TypeScript
  (p. ej. `lib/types/roles.ts`) alineada con el enum de Prisma, con los cuatro
  valores, de la que el seed deriva la lista a insertar (sin una segunda lista
  duplicada ni desincronizada).

## Seed de valores

- **R8 (ubicuo):** El sistema DEBE garantizar, tras ejecutar el seed, la existencia
  en la tabla `rol` de una fila por cada valor del enum: `'maestro'`, `'admin'`,
  `'mensajero'` y `'Admin Tienda'` (grafías exactas).

## Idempotencia

- **R9 (por evento):** CUANDO el seed se ejecuta y un `value` del enum ya existe en
  `rol`, el sistema DEBE conservar la fila existente (identificada por su `value`
  único) sin crear un duplicado y sin cambiar su `id`.
- **R10 (por evento):** CUANDO el seed se ejecuta dos o más veces consecutivas sobre
  la misma base de datos, el sistema DEBE dejar exactamente una fila por cada
  `value` del enum (el número de filas con esos `value` no aumenta entre
  ejecuciones sucesivas).

## No sembrar `usuario`

- **R11 (por evento):** CUANDO el seed se ejecuta, el sistema NO DEBE crear un rol
  con `value` `'usuario'` (no forma parte del enum ni del catálogo). Nota: la tabla
  `usuario` está VACÍA, por lo que retirar/omitir `'usuario'` es seguro y no hay
  riesgo de clave foránea.

## Aislamiento

- **R12 (por evento):** CUANDO el seed se ejecuta, el sistema NO DEBE modificar
  ninguna otra tabla del esquema (`usuario`, `tipo_identificacion`, `permiso`,
  `rol_permiso`, etc.).

## Ejecución

- **R13 (ubicuo):** El sistema DEBE poder ejecutar el seed de roles mediante el
  comando de seed del proyecto `pnpm db:seed` (extendiendo
  `scripts/seed-catalogos.ts`; ver `design.md`).
- **R14 (condicional):** SI el proceso de seed falla en cualquier upsert, ENTONCES
  el sistema DEBE terminar con código de salida distinto de cero y registrar el
  error, coherente con `scripts/seed-catalogos.ts` (no fallar en silencio).

## Criterios de aceptación (verificables)

- `migration.sql` de login contiene `CREATE TYPE "rol_value" AS ENUM ('maestro',
  'admin', 'mensajero', 'Admin Tienda')` antes de la creación de `rol`, y la columna
  `value` de `rol` usa ese tipo (R1, R4, R5).
- `prisma validate` pasa con el enum declarado y `Rol.value` tipado como enum
  (R2, R3).
- `down.sql` de login contiene `DROP TYPE IF EXISTS "rol_value"` (R6).
- Existe el módulo TS con la fuente única de verdad y el seed itera sobre él (R7).
- Tras `pnpm db:seed`, `SELECT value FROM rol` contiene `maestro`, `admin`,
  `mensajero` y `Admin Tienda` (R8).
- Ejecutar `pnpm db:seed` dos veces seguidas deja `count(*) FROM rol WHERE value IN
  ('maestro','admin','mensajero','Admin Tienda') = 4` (R9, R10).
- Tras el seed, no existe rol `'usuario'` recién creado (R11).
- El seed no altera `count(*)` de `usuario`, `tipo_identificacion`, `permiso` ni
  `rol_permiso` (R12).
- El comando `pnpm db:seed` existe y ejecuta la lógica de roles (R13).
- Forzar un fallo de conexión hace que el proceso salga con código ≠ 0 (R14).

## Decisiones firmes

1. **Ortografía `'mensajero'`** (con `j`). Definitiva.
2. **Cuarto rol** `'Admin Tienda'` (A/T mayúsculas + espacio). Definitivo; en Prisma
   el miembro del enum se declara con identificador válido + `@map("Admin Tienda")`.
3. **Enum de Postgres** (no solo TS). Se crea en la migración de login (editada, no
   nueva) y se declara en `db/schema.prisma`. `Rol.value` pasa de `String` a ese
   enum.
4. **`usuario`** se retira del seed. La tabla `usuario` está vacía → cambio seguro,
   sin riesgo de FK (por eso NO hay requisito de "purga condicionada").
