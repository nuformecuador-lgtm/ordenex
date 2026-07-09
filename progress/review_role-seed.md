# Review — role-seed

**Veredicto: APROBADO** (0 bloqueantes)

Revisión ejecutable de la feature id 4 (`role seed`, low) contra
`specs/role-seed/{requirements,design,tasks}.md`, docs y CHECKPOINTS.

## Checklist

### Especificación
- [x] `requirements.md` con R1–R14 en EARS numerados.
- [x] `design.md` con alternativas descartadas y su porqué (4 descartadas).
- [x] `tasks.md` con T001–T019 todas marcadas `[x]`.

### Trazabilidad
- [x] Cada R1–R14 mapea a al menos un test real y no vacío (tabla abajo).
- [x] `progress/impl_role-seed.md` contiene el mapa `R<n> -> test`.

### Calidad de código (ejecutado por el reviewer, no confiado al reporte)
- [x] `pnpm db:generate` -> Prisma Client v7.8.0 generado, con enum `RolValue`.
- [x] `pnpm typecheck` (tsc --noEmit) -> sin errores.
- [x] `pnpm lint` (eslint) -> sin errores.
- [x] `pnpm test` (vitest run) -> 24 archivos, 144 tests, todos verdes.
- [x] `./init.sh` -> `== init OK ==`, exit 0. (Advertencia esperada: no hay `.env`.)

### Enum Postgres (verificación exacta de labels)
- [x] `migration.sql` línea 5: `CREATE TYPE "rol_value" AS ENUM ('maestro',
      'admin', 'mensajero', 'Admin Tienda')`. EXACTAMENTE 4 labels. `'mensajero'`
      con `j` (no `mensagero`). `'Admin Tienda'` con A/T mayúsculas y espacio.
      NO aparece `'usuario'`.
- [x] CREATE TYPE (línea 5) precede a `CREATE TABLE "rol"` (línea 19) -> R4.
- [x] Columna `"value" "rol_value" NOT NULL` (no TEXT) -> R5.
- [x] Índice único `rol_value_key` conservado (línea 88) -> R3/R5.
- [x] `schema.prisma`: `enum RolValue { maestro / admin / mensajero /
      adminTienda @map("Admin Tienda") / @@map("rol_value") }`; `Rol.value
      RolValue @unique` (deja de ser String) -> R2/R3.

### Migración reversible
- [x] `down.sql`: `DROP TABLE ... "rol"` (línea 12) antes de
      `DROP TYPE IF EXISTS "rol_value"` (línea 16). Orden correcto -> R6.

### Seed
- [x] `ROLES_SEED = Object.values(RolValue)` (fuente única, sin lista literal
      duplicada) -> R7.
- [x] `seedRoles` itera `ROLES_SEED` con `upsert { where:{value}, update:{},
      create:{value} }`: idempotente, sin delete, sin transformación de strings.
- [x] No siembra `'usuario'` (sólo aparece en un comentario) -> R11.
- [x] Sólo toca `rol`; no modifica otras tablas -> R12.
- [x] `pnpm db:seed` cableado a `scripts/seed-catalogos.ts` -> R13.
- [x] Fallo de upsert propaga rechazo (main -> process.exit(1)) -> R14.

### Seguridad / alcance
- [x] `rol` ya tiene RLS habilitado en la migración de login (línea 141). No hay
      tabla nueva.
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda.
- [x] NO se tocó UI (`app/`) ni se añadió nada fuera de alcance. Diff de
      role-seed: `schema.prisma`, `migration.sql`, `down.sql`,
      `seed-catalogos.ts`, `lib/types/roles.ts` y 3 archivos de test.

## Mapa R<n> -> test (estado)

| R   | Test | Estado |
|-----|------|--------|
| R1  | role-seed-migration.test.ts :: "crea el enum rol_value con los cuatro labels exactos" (regex exacto) | OK |
| R2  | roles.test.ts :: "@@map(rol_value)" + "incluye los cuatro miembros, con @map(Admin Tienda)" | OK |
| R3  | roles.test.ts :: "tipa Rol.value como RolValue @unique" | OK |
| R4  | role-seed-migration.test.ts :: "declara el CREATE TYPE ... ANTES de crear la tabla rol" | OK |
| R5  | role-seed-migration.test.ts :: "tipa la columna value ... rol_value" + "conserva el indice unico rol_value_key" | OK |
| R6  | role-seed-migration.test.ts :: "dropea el tipo rol_value" + "... DESPUES de eliminar la tabla rol" | OK |
| R7  | roles.test.ts :: "cuatro valores del enum, sin duplicados" + "se deriva del enum RolValue de Prisma" | OK |
| R8  | seed-catalogos.test.ts :: "persiste una fila por cada valor del enum con el label real de la DB" (fake replica @map) | OK (real DB diferido) |
| R9  | seed-catalogos.test.ts :: "dos ejecuciones ... id estable" | OK |
| R10 | seed-catalogos.test.ts :: "dos ejecuciones dejan exactamente 4 filas" | OK |
| R11 | roles.test.ts :: "NO incluye 'usuario'" + seed-catalogos.test.ts :: "no existe fila con value 'usuario'" | OK |
| R12 | seed-catalogos.test.ts :: "solo usa prisma.rol.upsert; otras tablas intactas" | OK |
| R13 | package.json cablea `db:seed` al script + seed importado/testeado | OK (config verificable) |
| R14 | seed-catalogos.test.ts :: "si un upsert rechaza, seedRoles rechaza" | OK (exit-code real diferido) |

## Hallazgos

- **menor:** R13 se cubre por verificación estructural de `package.json`, no por
  un test automatizado. Aceptable: el script está cableado y `seedRoles` se
  ejercita en tests; el comando `pnpm db:seed` se ejecuta en la deuda diferida.
- **menor:** R8/R14 (aplicar migración+seed contra Postgres real y exit-code
  end-to-end) quedan DIFERIDOS por ausencia de DB, coherente con la misma
  limitación documentada en login/permissions. NO ocultan un requisito sin test:
  el label `'Admin Tienda'` está verificado en el DDL (migración) y en el schema
  (`@map`), y el fake de Prisma replica la traducción nombre->label; la
  propagación del fallo está cubierta. Documentado en `impl_role-seed.md`.
- **menor (fuera de alcance de role-seed):** `feature_list.json` tiene DOS
  features en `in_progress` (id 4 y id 5 `home`). Es responsabilidad del leader,
  no de esta feature; `init.sh` pasó verde igualmente. Se señala para que el
  leader lo resuelva antes de arrancar la siguiente feature.

Ningún hallazgo es bloqueante. La desviación documentada
(`ROLES_SEED = Object.values(RolValue)` expone el nombre del miembro
`adminTienda`, no el label) es correcta para Prisma 7.8 y es la única
implementación que satisface R7, compila y persiste `'Admin Tienda'` vía `@map`.

## Veredicto final: APROBADO
