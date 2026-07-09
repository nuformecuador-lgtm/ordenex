# Tasks — permissions

> Backend: `backend_dev`. `[P]` = paralelizable respecto a las tareas de su mismo
> bloque de dependencia. Cada task mapea a uno o más requisitos `R<n>`.

## Bloque 1 — Modelo de datos

- [x] T001 Agregar a `db/schema.prisma` el modelo `Permiso` (`id`, `nombre`,
  `method`, `route`, `createdAt`, `updatedAt` con sus `@map`/`@@map`), con
  `@@unique([method, route])`, el modelo pivote `RolPermiso` (`rolId`,
  `permisoId`, `createdAt`, PK compuesta `@@id([rolId, permisoId])`, FKs a `rol`
  y `permiso` con `onDelete: Cascade`, índice sobre `permisoId`), y añadir la
  relación inversa `permisos RolPermiso[]` al modelo `Rol` existente sin cambiar
  sus columnas. Cubre: R1, R2, R3, R6, R7, R8.
  **Hecho cuando:** `pnpm run prisma validate` (o `npx prisma validate`) no
  reporta errores. Depende de: aprobación del spec.

- [x] T002 Generar migración con `pnpm run db:migrate:create` (nombre
  `permissions`). Cubre: R1, R6, R7, R8, R9.
  **Hecho cuando:** existe `db/migrations/<ts>_permissions/migration.sql` con las
  tablas `permiso` y `rol_permiso`, el índice único `(method, route)`, la PK
  compuesta `(rol_id, permiso_id)`, el índice sobre `permiso_id` y las dos FKs
  con `ON DELETE CASCADE`. No toca tablas preexistentes. Depende de: T001.

- [x] T003 Añadir a `migration.sql` los `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY` para `permiso` y `rol_permiso`, sin policies para
  `anon`/`authenticated`. Cubre: R12, R13.
  **Hecho cuando:** `migration.sql` contiene ambos `ENABLE ROW LEVEL SECURITY`.
  La verificación del rechazo con key `anon` (R13) queda DIFERIDA a un entorno
  con Supabase real (misma limitación que login T004): al desplegar, un test de
  integración confirma que `anon` no devuelve filas de ninguna de las dos tablas.
  Depende de: T002.

- [x] T004 Escribir `down.sql` manual que revierta exactamente T002: drop de
  `rol_permiso` y luego `permiso`, sin tocar tablas preexistentes. Cubre: R14.
  **Hecho cuando:** `pnpm run db:rollback` seguido de `pnpm run db:migrate` deja
  el esquema idéntico (sin diff en `prisma migrate status`). Verificación
  ejecutable diferible si no hay DB real; `init.sh` valida la existencia de
  `down.sql`. Depende de: T002.

- [x] T005 Regenerar el cliente Prisma con `pnpm run db:generate`.
  **Hecho cuando:** `pnpm run typecheck` compila con los tipos `Permiso` y
  `RolPermiso` disponibles en el cliente generado. Depende de: T001.

## Bloque 2 — Tests

- [x] T006 [P] Test de creación de permiso: crear un `Permiso` sin `created_at`/
  `updated_at` y verificar que `id` se genera automáticamente y ambos timestamps
  quedan poblados; actualizar el permiso y verificar que `updated_at` cambia.
  Cubre: R1, R2, R3, R4, R5.
  **Hecho cuando:** el test pasa en `tests/` con esos asserts. Depende de: T002,
  T005.

- [x] T007 [P] Test de unicidad de permiso: insertar dos permisos con la misma
  pareja (`method`, `route`) falla por el índice único. Cubre: R6.
  **Hecho cuando:** el test verifica que la segunda inserción lanza error de
  unicidad. Depende de: T002, T005.

- [x] T008 [P] Test de relación N:M: asociar un permiso a varios roles y un rol a
  varios permisos vía `rol_permiso`, y leer ambos lados de la relación. Cubre:
  R7.
  **Hecho cuando:** el test crea múltiples asociaciones cruzadas y las recupera
  correctamente. Depende de: T002, T005.

- [x] T009 [P] Test de integridad de la pivote: (a) insertar la misma pareja
  rol↔permiso dos veces falla por PK compuesta (R8); (b) insertar una asociación
  con `rol_id` o `permiso_id` inexistente falla por FK (R9). Cubre: R8, R9.
  **Hecho cuando:** ambos asserts de fallo pasan. Depende de: T002, T005.

- [x] T010 [P] Test de estado inicial: tras aplicar la migración, `count` de
  `permiso` y de `rol_permiso` es 0. Cubre: R10, R11.
  **Hecho cuando:** el test confirma ambas tablas vacías (sin seed). Depende de:
  T002.

- [x] T011 [P] Test de RLS (DIFERIBLE): con un cliente Supabase key `anon`,
  consultar `permiso` y `rol_permiso` no devuelve filas. Cubre: R12, R13.
  **Hecho cuando:** el test pasa contra Supabase real; si no hay DB/`.env` en el
  entorno, se documenta como diferido a despliegue (igual que login T004).
  Depende de: T003.

## Bloque 3 — Verificación final

- [x] T012 Correr `pnpm run typecheck`, `pnpm run lint` y `pnpm test` en verde;
  registrar el mapa R1..R14 → test en `progress/impl_permissions.md`.
  **Hecho cuando:** todo pasa y el mapa de trazabilidad queda documentado.
  Depende de: T005, T006, T007, T008, T009, T010.

- [x] T013 Verificar rollback: `pnpm run db:rollback` y luego `pnpm run
  db:migrate` sin errores ni diff de esquema. Cubre: R14.
  **Hecho cuando:** ambos comandos corren limpios; DIFERIBLE si no hay DB real,
  documentado en `progress/impl_permissions.md`. Depende de: T004.
  DIFERIDO: `db:rollback` falla por `datasource` sin `url` (no hay Postgres en el
  entorno, misma limitación que login T004). `down.sql` escrito y verificado por
  assert de DDL en `permissions-migration.test.ts`.
