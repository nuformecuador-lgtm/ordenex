# Diseño — role-seed

## Alcance técnico

Feature de complejidad `low`: (1) catálogo de roles como enum de Postgres declarado
en la migración de login (todavía sin aplicar) y en `db/schema.prisma`, con
`Rol.value` tipado como ese enum; (2) fuente única de verdad en TypeScript alineada
con el enum; (3) seed idempotente que inserta los cuatro valores vía `pnpm db:seed`
sin sembrar `usuario`. No hay tablas nuevas, servicios, endpoints ni UI.

## Contexto verificado del repo

- La tabla `rol` se crea en la migración de login
  `db/migrations/20260708212416_login_usuario_rba/migration.sql` con
  `"value" TEXT NOT NULL` e índice único `rol_value_key` (línea 16-21 y 85). Esa
  migración AÚN NO está aplicada, por lo que se EDITA (no se crea una nueva
  incremental con `ALTER TYPE`).
- Ya existe un enum de Postgres precedente:
  `CREATE TYPE "estado_usuario" AS ENUM (...)` en el mismo `migration.sql` (línea 2),
  con su `DROP TYPE IF EXISTS "estado_usuario"` en `down.sql` (línea 15) y su modelo
  Prisma `enum EstadoUsuario { ... @@map("estado_usuario") }` (schema línea 63). Se
  replica ESE patrón.
- La tabla `usuario` está VACÍA → omitir/retirar `'usuario'` del catálogo es seguro,
  sin riesgo de FK (no existe requisito de purga condicionada).

## Enum de Postgres (schema)

Se declara en `db/schema.prisma`, imitando `EstadoUsuario`. El label `'Admin Tienda'`
tiene espacio y mayúsculas, que NO son válidos como identificador de miembro de enum
en Prisma; se usa `@map("Admin Tienda")` (mismo truco que `@@map` de nombres):

```prisma
enum RolValue {
  maestro
  admin
  mensajero
  adminTienda @map("Admin Tienda") // label literal en la DB: 'Admin Tienda'

  @@map("rol_value")
}
```

`Rol.value` deja de ser `String` y pasa al enum, conservando la unicidad:

```prisma
model Rol {
  id       String       @id @default(uuid())
  value    RolValue     @unique
  usuarios Usuario[]
  permisos RolPermiso[]

  @@map("rol")
}
```

Nota: `@unique` sobre una columna enum es válido y conserva `rol_value_key`. Aunque
el enum ya restringe el dominio a cuatro labels, el `@unique` sigue teniendo sentido
como clave natural del catálogo (una fila por valor) y es la clave del upsert
idempotente del seed.

## Edición de la migración de login (no crear nueva)

En `db/migrations/20260708212416_login_usuario_rba/migration.sql`:

1. Añadir el `CREATE TYPE` del enum de rol junto al de `estado_usuario`, ANTES de la
   creación de la tabla `rol` (R4):

```sql
-- CreateEnum
CREATE TYPE "estado_usuario" AS ENUM ('pendiente', 'activo', 'inactivo', 'bloqueado');

-- CreateEnum
CREATE TYPE "rol_value" AS ENUM ('maestro', 'admin', 'mensajero', 'Admin Tienda');
```

2. Cambiar la columna `value` de la tabla `rol` de `TEXT` al tipo enum (R5),
   manteniendo el índice único `rol_value_key` ya existente (línea 85, sin cambios):

```sql
CREATE TABLE "rol" (
    "id" TEXT NOT NULL,
    "value" "rol_value" NOT NULL,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("id")
);
```

En `db/migrations/20260708212416_login_usuario_rba/down.sql`: añadir el `DROP TYPE`
del enum de rol después de eliminar las tablas (la tabla `rol` se dropea antes),
junto al `DROP TYPE` de `estado_usuario` ya presente (R6):

```sql
DROP TABLE IF EXISTS "rol";
DROP TABLE IF EXISTS "tipo_identificacion";

DROP TYPE IF EXISTS "estado_usuario";
DROP TYPE IF EXISTS "rol_value";
```

Como la migración no se ha aplicado, tras editarla se corre `pnpm run db:generate`
para regenerar el cliente Prisma con el enum `RolValue`, y `prisma validate` para
confirmar consistencia schema↔migración.

## Fuente única de verdad en TS

Módulo reutilizable (p. ej. `lib/types/roles.ts`) alineado con el enum de Prisma. El
enum generado por Prisma (`RolValue`) puede reexportarse/derivarse aquí para que el
seed itere una sola lista (R7):

```ts
// lib/types/roles.ts
import { RolValue } from "@prisma/client";

// Fuente única de verdad de los valores a sembrar (todos los del enum). NO incluye "usuario".
export const ROLES_SEED: RolValue[] = Object.values(RolValue);
```

`Object.values(RolValue)` produce los labels de la DB (`'maestro'`, `'admin'`,
`'mensajero'`, `'Admin Tienda'`), que es exactamente lo que se persiste en
`rol.value`. Así no hay una segunda lista literal que mantener.

## Seed (extender `scripts/seed-catalogos.ts`)

Se extiende el seed existente (único entrypoint cableado en `package.json`:
`"db:seed": "tsx scripts/seed-catalogos.ts"`, R13). El bucle de roles deja de usar
la lista literal `["admin", "usuario"]` y pasa a iterar `ROLES_SEED`, que NO incluye
`'usuario'` (R11):

```ts
import { ROLES_SEED } from "@/lib/types/roles"; // o ruta relativa

// dentro de main():
for (const value of ROLES_SEED) {
  await prisma.rol.upsert({
    where: { value },
    update: {},
    create: { value },
  });
}
```

Idempotencia (R8-R10):
- `where: { value }` usa el índice único `rol_value_key` para localizar la fila.
- `create: { value }` inserta solo si no existe (primera corrida).
- `update: {}` no-op: si ya existe, conserva la fila y su `id`.
- Re-ejecución: todos caen en `update: {}` → cero filas nuevas, cuenta estable.
- No hay `delete`/`deleteMany`: nada se borra (R12).

Los valores se insertan tal cual los expone el enum, sin `trim`/`toLowerCase`, para
que `'Admin Tienda'` y `'mensajero'` se persistan con su grafía exacta.

`pnpm db:seed` requiere `DATABASE_URL`; el script mantiene su `try/finally` con
`$disconnect` y el handler `main().catch(...) => process.exit(1)` (R14).

## RLS / seguridad

Sin cambios: `rol` ya habilita RLS en la migración de login (línea 138). El seed
corre desde el servidor con service role (Prisma). No se hardcodean secretos.

## Alternativas descartadas

1. **Crear una migración incremental nueva con `ALTER TYPE`/`ALTER TABLE` para
   introducir el enum.** Descartada porque la migración de login AÚN NO se aplicó:
   editar su `migration.sql`/`down.sql` deja el historial limpio y evita una
   secuencia `TEXT → enum` innecesaria. `ALTER TYPE ... ADD VALUE` y la conversión de
   columna solo tendrían sentido si la migración ya estuviera aplicada en algún
   entorno, que no es el caso.
2. **Mantener el enum solo en TypeScript (`String @unique` en la DB).** Descartada:
   el humano pidió explícitamente enum de Postgres. El enum en DB restringe el
   dominio a nivel de motor (una fila con `value` inválido es imposible), más fuerte
   que validar solo en el código.
3. **Declarar el miembro del enum Prisma como `Admin Tienda` sin `@map`.** Imposible:
   Prisma exige identificadores válidos en los miembros del enum; el espacio y la
   mayúscula obligan a un miembro identificador (`adminTienda`) con `@map("Admin
   Tienda")` para el label literal de la DB.
4. **`createMany({ skipDuplicates: true })` en vez de `upsert`.** Descartada por
   coherencia con el patrón `upsert` ya establecido en `seed-catalogos.ts`; mezclar
   dos estilos de idempotencia en el mismo archivo perjudica la legibilidad.

## Trazabilidad prevista

- R1, R4 → test: `migration.sql` contiene `CREATE TYPE "rol_value" AS ENUM
  ('maestro','admin','mensajero','Admin Tienda')` antes de crear `rol`.
- R2, R3 → test: `prisma validate` OK; `db/schema.prisma` declara `enum RolValue`
  con `@map("Admin Tienda")` y `Rol.value` es `RolValue @unique`.
- R5 → test: en `migration.sql`, la columna `value` de `rol` es de tipo `"rol_value"`
  y persiste el índice único `rol_value_key`.
- R6 → test: `down.sql` contiene `DROP TYPE IF EXISTS "rol_value"` (después del drop
  de `rol`).
- R7 → test: `ROLES_SEED` tiene los 4 valores exactos y NO contiene `'usuario'`.
- R8 → test: tras seed, existe una fila por cada `value` del enum, grafía exacta.
- R9, R10 → test de idempotencia: correr el seed dos veces deja 4 filas, sin
  duplicados y con `id` estable.
- R11 → test: tras el seed sobre DB limpia, no existe rol `'usuario'`.
- R12 → test: `count` de otras tablas no cambia tras el seed.
- R13 → verificación: `pnpm db:seed` ejecuta la lógica de roles (script cableado).
- R14 → test/observación: fallo de conexión → exit code ≠ 0.
