# Diseño — rol-adminsatelite (feature 19)

## Alcance técnico

Complejidad `low`, zona `backend`. Añadir el rol `adminSatelite` al catálogo
(5.º valor). Tres capas coordinadas:

1. **Enum de Postgres** `rol_value`: nuevo miembro Prisma + migración incremental
   `ALTER TYPE ... ADD VALUE` con su `down.sql`.
2. **Fuente única de verdad TS** (`lib/types/roles.ts`): sin cambios de código, se
   propaga solo al regenerar el cliente (`ROLES_SEED = Object.values(RolValue)`).
3. **Seed idempotente** (`scripts/seed-catalogos.ts` → `seedRoles`): sin cambios de
   código; siembra el 5.º rol al iterar el `ROLES_SEED` ya de 5.

Sin tablas nuevas, sin endpoints, sin UI, sin cambios en la lógica de servicios.

## Diferencia clave respecto a la feature 4

En feature 4 (`specs/role-seed/`) la migración de login **aún no estaba aplicada**,
por lo que se editó su `migration.sql`/`down.sql`. **Aquí NO aplica**: la migración
`20260708212416_login_usuario_rba` ya está aplicada (hay 5 migraciones posteriores).
Editar una migración ya aplicada corrompe el historial de Prisma Migrate. Por tanto
el cambio de enum se hace en una **migración incremental nueva** con `ALTER TYPE`.

## Miembro del enum y `@map` (R1, R2)

```prisma
enum RolValue {
  maestro
  admin
  mensajero
  adminTienda   @map("Admin Tienda")
  adminSatelite // label literal en la DB: 'adminSatelite' (slug camelCase, SIN @map)

  @@map("rol_value")
}
```

El miembro identificador es `adminSatelite` y su label en la DB es exactamente
`adminSatelite` (lo que expone el cliente Prisma y lo que `seedRoles` pasa a
`rol.upsert`). A diferencia de `adminTienda @map("Admin Tienda")`, `adminSatelite` NO
lleva `@map`: el nombre del miembro ya es un identificador válido igual al label
deseado (decisión humana 2026-07-10, [D1] en `requirements.md`).

## Migración incremental `ALTER TYPE ADD VALUE` (R3)

Carpeta nueva, p. ej. `db/migrations/20260710130000_rol_admin_satelite/` (timestamp
posterior a `20260710120000_cobros`, la última). `migration.sql`:

```sql
-- AlterEnum: añade el 5.º rol al catálogo (feature 19).
-- Postgres 15+ (Supabase) permite ADD VALUE dentro de la transaccion de Prisma Migrate
-- siempre que el nuevo valor NO se use en la misma transaccion (aqui solo se añade).
ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS 'adminSatelite';
```

`IF NOT EXISTS` hace la migración re-aplicable sin error si el label ya existe.
El label es el slug camelCase `'adminSatelite'` ([D1]); Postgres 15+ del entorno
([D3]) hace la ejecución transaccional compatible sin ajustes.

## `down.sql` — reto del enum de Postgres (R4, R5)

Postgres **no soporta** `ALTER TYPE ... DROP VALUE`. Para revertir hay que recrear el
tipo sin el label. Como el único uso del tipo es `rol.value` (verificado en el
schema), el procedimiento es acotado:

```sql
-- DOWN: Postgres no permite DROP VALUE de un enum -> se recrea el tipo sin 'adminSatelite'.
-- Precondicion (R5): ninguna fila de "usuario" referencia el rol 'adminSatelite'
-- (rol recien creado). Si la hubiera, el DELETE falla por la FK y el rollback aborta,
-- evitando estado inconsistente.

-- 1. Retirar la fila de catalogo del rol nuevo (si el seed la creo).
DELETE FROM "rol" WHERE "value" = 'adminSatelite';

-- 2. Renombrar el tipo actual y crear el tipo original (4 labels EXISTENTES tal cual en DB).
--    adminTienda conserva su label 'Admin Tienda'; solo se excluye 'adminSatelite'.
ALTER TYPE "rol_value" RENAME TO "rol_value_old";
CREATE TYPE "rol_value" AS ENUM ('maestro', 'admin', 'mensajero', 'Admin Tienda');

-- 3. Migrar la columna al tipo recreado (cast por texto) y limpiar el default si lo hubiera.
ALTER TABLE "rol" ALTER COLUMN "value" TYPE "rol_value" USING ("value"::text::"rol_value");

-- 4. Eliminar el tipo viejo.
DROP TYPE "rol_value_old";
```

Notas:
- El `DELETE` va primero: si quedara una fila `rol` con `'adminSatelite'`, el
  `ALTER COLUMN ... USING (...::"rol_value")` fallaría (el label ya no existe en el
  tipo nuevo). El `DELETE` solo puede fallar si un `usuario.rol_id` la referencia
  (FK `usuario_rol_id_fkey`), lo que es justamente la protección de R5.
- Este `down.sql` NO es transaccional-hostil: `RENAME`, `CREATE TYPE` y `ALTER COLUMN`
  conviven en una transacción normal (no hay `ADD VALUE` en el down).
- Decisión humana 2026-07-10 ([D2]): el down **recrea el tipo** (no se usa la opción
  no-op).

## Fuente única de verdad TS (R6)

`lib/types/roles.ts` **no cambia**:

```ts
export const ROLES_SEED: RolValue[] = Object.values(RolValue);
```

Tras `pnpm run db:generate`, `RolValue` expone 5 miembros y `Object.values` produce
los 5 labels DB (`'maestro'`, `'admin'`, `'mensajero'`, `'Admin Tienda'`,
`'adminSatelite'`). No hay segunda lista que mantener.

## Seed (R7, R8)

`seedRoles` **no cambia**: itera `ROLES_SEED` con `upsert({ where:{value},
update:{}, create:{value} })`. Al pasar de 4 a 5 elementos, el 5.º rol se siembra sin
tocar nada más. Idempotencia intacta (índice único `rol_value_key`, `update:{}`
no-op, sin `delete`). El fake in-memory del test de seed añade el mapeo
`adminSatelite -> 'adminSatelite'` en su `DB_LABEL` (identidad: sin `@map`, el nombre
del miembro y el label DB coinciden).

## Impacto en autorización / switches de rol (R9, R10, R11, R12)

Verificado por grep: **no hay `switch` exhaustivo sobre `RolValue` ni `assertNever`**.
Toda la autorización por rol es defensiva (Set-membership o `!==` con
default-`forbidden`). Consecuencia de añadir `adminSatelite`:

| Servicio | Puerta actual | Efecto para `adminSatelite` |
|---|---|---|
| `OrdenService.crear` | `!KNOWN_ROLES.has(rol)` (línea 28) | no está en `KNOWN_ROLES` → `forbidden` (R24) |
| `CobroService` | `READ_ROLES`/`WRITE_ROLES` (16-17) | no listado → sin acceso |
| `AsignacionMensajeroService` | `!== adminTienda/maestro/admin` (26) | `forbidden` |
| `BulkOrdenService` | `!== adminTienda` (166) | `forbidden` |

Los `Actor.rol: RolValue` (`IOrdenService`, `ICobroService`) solo se ensanchan; las
comparaciones por string siguen compilando. Por tanto **no se toca código de
servicio** y el typecheck no se rompe (R12). La feature 22 (aprobación de
postulaciones) deberá excluir explícitamente `adminSatelite` de la lista de
aprobadores (R10); no existe ese código hoy, así que aquí solo se deja el requisito
como restricción de no-regresión.

## RLS / seguridad

Sin cambios: `rol` ya tiene RLS habilitada (migración de login). El seed corre desde
el servidor con service role. No hay secretos.

## Alternativas descartadas

1. **Editar la migración de login `20260708212416_login_usuario_rba`** para añadir el
   5.º label al `CREATE TYPE` (como hizo la feature 4). **Descartada:** esa migración
   **ya está aplicada** (existen 5 migraciones posteriores). Modificar una migración
   aplicada rompe el checksum/historial de Prisma Migrate y no se propaga a entornos
   ya migrados. La vía correcta es una migración incremental con `ALTER TYPE ... ADD
   VALUE`.
2. **`down.sql` no-op / best-effort** (dejar el label huérfano en el enum). Es más
   simple y evita el riesgo de FK, pero no revierte el DDL del tipo → asimetría
   up/down. **Descartada** por decisión humana ([D2]): el down recrea el tipo por
   simetría y limpieza.
3. **Convertir `rol_value` a tabla de catálogo `String`** (quitar el enum de Postgres)
   para que añadir roles no requiera DDL. **Descartada:** cambia una decisión firme de
   la feature 4 (enum de Postgres como dominio a nivel de motor) y excede el alcance
   `low` de esta feature.
4. **Añadir el label solo en TS (`lib/types/roles.ts`) sin tocar el enum de la DB.**
   **Descartada:** el seed insertaría un `value` que el enum de Postgres rechazaría
   (fila inválida imposible por el tipo) → error en runtime. El dominio debe ampliarse
   primero en la DB.

## Trazabilidad prevista (R → test)

- R1, R2 → test de schema: el miembro `adminSatelite` aparece en `enum RolValue`
  **sin `@map`** (regex `adminSatelite` no seguido de `@map`); `enum RolValue` con 5
  miembros.
- R3 → test de migración: `migration.sql` nuevo contiene `ALTER TYPE "rol_value" ADD
  VALUE IF NOT EXISTS 'adminSatelite'`; la migración de login no cambia.
- R4, R5 → test de `down.sql`: contiene `RENAME TO "rol_value_old"`, `CREATE TYPE
  "rol_value" AS ENUM ('maestro','admin','mensajero','Admin Tienda')`, `ALTER TABLE
  "rol" ALTER COLUMN "value" TYPE`, `DROP TYPE "rol_value_old"`, y `DELETE FROM "rol"
  WHERE "value" = 'adminSatelite'` antes del `ALTER COLUMN`.
- R6 → test de fuente de verdad: `ROLES_SEED` longitud 5, incluye
  `RolValue.adminSatelite`; deriva de `Object.values(RolValue)`.
- R7 → test de `seedRoles` (fake): persiste 5 filas, una con `'adminSatelite'`.
- R8 → test de idempotencia: dos corridas → 5 filas, `id` estable.
- R9, R11 → tests de servicios: `adminSatelite` → `forbidden` en OrdenService,
  CobroService (read+write), AsignacionMensajero, BulkOrden; los 4 roles previos
  conservan su resultado.
- R10 → verificación (grep): ninguna lista de aprobadores incluye `adminSatelite`
  (hoy no existe; nota para feature 22).
- R12 → `pnpm run typecheck` verde.
