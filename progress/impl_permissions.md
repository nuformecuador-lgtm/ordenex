# Implementación — permissions (id 3, low)

Estado: VERDE para todo lo verificable sin DB real. Deuda diferida documentada
(RLS efectivo y rollback contra Postgres), idéntica a la limitación de login.

Alcance: 100% backend/DB. Solo `backend_dev` (modelo opus). No se tocó frontend.
Tablas `permiso` y `rol_permiso` quedan VACÍAS (sin seed).

## Archivos creados
- db/migrations/20260709084242_permissions/migration.sql
- db/migrations/20260709084242_permissions/down.sql
- lib/interfaces/repositories/IPermisoRepository.ts
- lib/interfaces/repositories/IRolPermisoRepository.ts
- lib/repositories/PermisoRepository.ts
- lib/repositories/RolPermisoRepository.ts
- tests/unit/repositories/permiso-repository.test.ts
- tests/unit/repositories/rol-permiso-repository.test.ts
- tests/integration/db/permissions-migration.test.ts

## Archivos modificados
- db/schema.prisma (modelos `Permiso`, `RolPermiso`; relación inversa
  `permisos RolPermiso[]` en `Rol` sin tocar sus columnas)
- specs/permissions/tasks.md (T001-T013 marcadas [x]; T013 con nota de diferido)

No modificados (confirmado): scripts/seed-catalogos.ts (sin seed de permisos).

## Mapa R<n> -> test
- R1  -> tests/unit/repositories/permiso-repository.test.ts :: "crear inserta nombre/method/route y NO envia timestamps ni id (R1, R2, R3, R4, R5)"
         + tests/integration/db/permissions-migration.test.ts :: "crea las tablas permiso y rol_permiso (R1, R7)"
- R2  -> permiso-repository.test.ts :: mismo test (assert: no se pasa `id`; lo genera @default(uuid()))
- R3  -> permiso-repository.test.ts :: mismo test (nombre/method/route no nulos)
- R4  -> permiso-repository.test.ts :: "(R4, R5)" + permissions-migration.test.ts :: "permiso.created_at tiene DEFAULT CURRENT_TIMESTAMP y existe updated_at (R4, R5)"
- R5  -> mismos dos tests (updated_at NOT NULL; @updatedAt en mock). Disparo real en UPDATE contra Postgres: DIFERIDO.
- R6  -> permissions-migration.test.ts :: "garantiza unicidad de (method, route) con un UNIQUE INDEX (R6)"
- R7  -> tests/unit/repositories/rol-permiso-repository.test.ts :: "asocia un rol con un permiso ... (R7)" + "permite leer ambos lados de la relacion N:M ... (R7)"
- R8  -> permissions-migration.test.ts :: "la pivote tiene PRIMARY KEY compuesta (rol_id, permiso_id) (R8)"
- R9  -> permissions-migration.test.ts :: "define las dos FKs de rol_permiso hacia rol y permiso con ON DELETE CASCADE (R9)"
- R10 -> permiso-repository.test.ts :: "contar devuelve ... 0 tras migrar sin seed (R10)" + permissions-migration.test.ts :: "NO toca tablas preexistentes (R10, R11)" + "seed-catalogos.ts NO inserta permisos"
- R11 -> rol-permiso-repository.test.ts :: "contar devuelve ... 0 tras migrar sin seed (R11)" + mismos tests de seed/DDL
- R12 -> permissions-migration.test.ts :: "habilita Row Level Security en ambas tablas sin policies (R12, R13)"
- R13 -> mismo test de RLS a nivel DDL. Rechazo real con key `anon`: DIFERIDO a Supabase real.
- R14 -> permissions-migration.test.ts (bloque down.sql) :: "dropea rol_permiso y permiso en orden inverso ..." + "NO toca tablas preexistentes ..."

## Salida real de verificación (ejecutada por el coordinador)

pnpm run typecheck  -> tsc --noEmit, sin errores.
pnpm run lint       -> eslint, sin errores/warnings.
pnpm test           -> vitest run:
    Test Files  21 passed (21)
         Tests  126 passed (126)
      Duration  ~18s
    (9 tests nuevos de esta feature dentro de los 126; suite de login intacta.)

npx prisma validate --schema=db/schema.prisma -> "The schema at db\schema.prisma is valid".
pnpm run db:generate -> cliente Prisma v7.8.0 regenerado con Permiso y RolPermiso.

Archivos de migración en disco: verificado
  db/migrations/20260709084242_permissions/{migration.sql, down.sql} presentes.

## Deuda diferida (justificada)
- R13 (rechazo real con key anon/authenticated): DIFERIDO. `datasource` sin `url`,
  no hay Supabase real en el entorno (misma limitación que login T004/T011). El DDL
  que lo garantiza (ENABLE ROW LEVEL SECURITY sin policies en ambas tablas) está
  verificado en verde por assert sobre migration.sql. Al desplegar, un test de
  integración debe confirmar que `anon` no devuelve filas.
- R5 (cambio efectivo de updated_at en un UPDATE contra Postgres): DIFERIDO a
  entorno con DB. Cubierto a nivel code/DDL.
- T013 (rollback ejecutable db:rollback + db:migrate sin diff): DIFERIDO. Corrí
  `pnpm run db:rollback` y falla por ausencia de datasource url (no hay Postgres),
  no por error de la migración. `down.sql` correcto y verificado por assert de DDL.
  `scripts/db-rollback.ts` ya detecta esta carpeta como última migración.
