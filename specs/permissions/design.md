# Diseño — permissions

## Alcance técnico

Feature de complejidad `low`: solo modelo de datos. Se agrega un modelo `Permiso`
y una relación muchos-a-muchos con el modelo `Rol` existente, mediante una tabla
pivote explícita `RolPermiso`. No hay servicios, endpoints, Server Actions ni UI
en esta feature. No se siembra ningún permiso (tablas vacías tras migrar).

## Convención de nombres

Coherente con `docs/conventions.md` (tablas/columnas Supabase en `snake_case` vía
`@map`/`@@map`) y con el esquema actual (`db/schema.prisma`): campos del modelo en
`camelCase`, mapeados a `snake_case` en la DB. El `id` es `String @id
@default(uuid())` como el resto de modelos.

## Modelo de datos (Prisma)

Se agrega a `db/schema.prisma`:

```prisma
model Permiso {
  id        String   @id @default(uuid())
  nombre    String
  method    String                                  // verbo HTTP (texto libre, ver "Alternativas")
  route     String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")

  roles     RolPermiso[]

  @@map("permiso")
  @@unique([method, route])                         // R6
}

// Tabla pivote explícita de la relación N:M rol <-> permiso.
model RolPermiso {
  rolId     String   @map("rol_id")
  permisoId String   @map("permiso_id")
  createdAt DateTime @default(now()) @map("created_at")

  rol       Rol      @relation(fields: [rolId], references: [id], onDelete: Cascade)
  permiso   Permiso  @relation(fields: [permisoId], references: [id], onDelete: Cascade)

  @@id([rolId, permisoId])                          // R8: pareja única
  @@map("rol_permiso")
  @@index([permisoId])
}
```

Y se añade el lado inverso de la relación al modelo `Rol` existente (única
modificación a un modelo previo; no cambia sus columnas):

```prisma
model Rol {
  id       String       @id @default(uuid())
  value    String       @unique
  usuarios Usuario[]
  permisos RolPermiso[]                             // <- nuevo, relación N:M

  @@map("rol")
}
```

Notas de diseño:
- **`method` como `String`** (texto libre) en lugar de enum Postgres: ver
  "Alternativas descartadas". Decisión marcada como revisable (ver pregunta
  abierta #1 de `requirements.md`).
- **`@@unique([method, route])`** cubre R6 a nivel DB (verificable con test).
- **`updatedAt` con `@updatedAt`** hace que Prisma gestione R5 automáticamente;
  `@default(now())` cubre R4.
- **Pivote explícita (`RolPermiso`)** en vez de implícita (`@relation` M:N sin
  modelo) porque permite `snake_case` en el nombre de la tabla pivote y sus
  columnas, añadir `created_at` a la asociación, y controlar RLS e índices
  explícitamente — coherente con el estilo del resto del esquema.
- `onDelete: Cascade` en ambas FKs: borrar un rol o un permiso limpia sus
  asociaciones sin dejar filas huérfanas.

## RLS (Supabase)

Ambas tablas nuevas se acceden solo desde el servidor (Prisma con service role),
como el resto del esquema. Por defensa en profundidad (`docs/architecture.md`:
"Tablas nuevas sin RLS" es anti-patrón), se habilita RLS sin políticas para
`anon`/`authenticated`, replicando el patrón de la migración de `login`:

```sql
ALTER TABLE "permiso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rol_permiso" ENABLE ROW LEVEL SECURITY;
-- Sin policies para anon/authenticated: RLS sin policy bloquea todo salvo service role.
```

## Migración

`db/migrations/<timestamp>_permissions/`:
- `migration.sql` (UP, generado con `pnpm run db:migrate:create`): crea las tablas
  `permiso` y `rol_permiso`, el índice único `(method, route)`, la PK compuesta
  `(rol_id, permiso_id)`, el índice sobre `permiso_id`, las dos FKs a `rol` y
  `permiso` con `ON DELETE CASCADE`, y los dos `ENABLE ROW LEVEL SECURITY`. NO
  toca tablas preexistentes salvo agregar la relación inversa (que no genera DDL
  sobre `rol`, es solo virtual en Prisma).
- `down.sql` (manual, OBLIGATORIO — R14): drop en orden inverso de dependencia:
  `rol_permiso` primero (depende de `permiso` y `rol`), luego `permiso`. No toca
  `rol`, `usuario` ni ninguna otra tabla.

```sql
-- down.sql
DROP TABLE IF EXISTS "rol_permiso";
DROP TABLE IF EXISTS "permiso";
```

## Estado inicial

No se ejecuta ningún seed en esta feature (R10, R11). El script existente
`scripts/seed-catalogos.ts` NO se modifica para insertar permisos. La tabla
`permiso` y `rol_permiso` quedan vacías tras migrar.

## Regeneración del cliente Prisma

Tras editar el esquema se corre `pnpm run db:generate` (`prisma generate`) para
que el cliente tipado incluya `Permiso` y `RolPermiso`. Es requisito para que el
`typecheck` y los tests que usen el cliente compilen.

## Alternativas descartadas

1. **`method` como enum Postgres** (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`).
   Descartada (por ahora) porque: (a) el enunciado no fija el conjunto de verbos;
   (b) un enum en Postgres es costoso de extender (requiere migración
   `ALTER TYPE ... ADD VALUE`) si mañana se necesita `HEAD`/`OPTIONS` o rutas no
   HTTP; (c) mantener texto libre no bloquea añadir el enum después. Queda como
   pregunta abierta confirmable; si el humano prefiere el catálogo cerrado, se
   cambia a enum antes de implementar.
2. **Relación N:M implícita de Prisma** (sin modelo `RolPermiso`, solo
   `permisos Permiso[]` / `roles Rol[]`). Descartada porque Prisma genera una
   tabla pivote con nombre `_PermisoToRol` y columnas `A`/`B`, lo que rompe la
   convención `snake_case` del proyecto, no permite añadir `created_at` a la
   asociación ni controlar RLS/índices de esa tabla explícitamente.
3. **Relación 1:N (un permiso pertenece a un solo rol, FK `rol_id` en `permiso`).**
   Descartada porque el mismo permiso (p. ej. `GET /orders`) típicamente lo
   comparten varios roles; 1:N obligaría a duplicar filas de permiso por rol,
   contradiciendo un catálogo de permisos reutilizable (R7). El enunciado ("la
   relación con los roles") es consistente con muchos-a-muchos.

## Trazabilidad prevista

- R1–R3 → test de repositorio/modelo: crear permiso y verificar columnas/tipos.
- R2 → test: `id` generado automáticamente y único.
- R4, R5 → test: timestamps poblados al crear y `updated_at` cambia al actualizar.
- R6 → test: insertar (`method`, `route`) duplicado falla.
- R7 → test: asociar un permiso a varios roles y un rol a varios permisos.
- R8 → test: pareja rol↔permiso duplicada falla (PK compuesta).
- R9 → test: asociación con `rol_id`/`permiso_id` inexistente falla por FK.
- R10, R11 → test: `count` = 0 tras migrar.
- R12, R13 → test de RLS con key `anon` (diferible a entorno con Supabase real,
  como en login T004).
- R14 → verificación de `db:rollback` + `db:migrate` sin diff.
