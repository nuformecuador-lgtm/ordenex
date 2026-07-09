# Review — permissions (id 3, low)

**Veredicto: APROBADO** — 0 bloqueantes.

Revisor: reviewer (arnés SDD). Verificación ejecutada por el propio reviewer, no
confiando en la bitácora del implementer.

## Verificación ejecutable (corrida por el reviewer)

| Comando | Resultado |
| --- | --- |
| `pnpm run typecheck` (`tsc --noEmit`) | VERDE, sin errores |
| `pnpm run lint` (`eslint`) | VERDE, sin errores/warnings |
| `pnpm test` (`vitest run`) | VERDE — 21 archivos, 126 tests |
| `npx prisma validate` | "The schema at db\schema.prisma is valid" |
| `./init.sh` | `== init OK ==` (down.sql presente en todas las migraciones) |

## Checklist CHECKPOINTS.md

- [x] `specs/permissions/requirements.md` con R1–R14 EARS numerados.
- [x] `design.md` con 3 alternativas descartadas (enum method, N:M implícita, 1:N) y su porqué.
- [x] `tasks.md` con T001–T013 todas `[x]`.
- [x] Cada R<n> mapea a ≥1 test concreto (tabla abajo).
- [x] `progress/impl_permissions.md` contiene el mapa R<n> -> test.
- [x] typecheck / lint / test verdes (reproducidos por el reviewer).
- [x] E2E: N/A — feature solo de modelo de datos, sin runtime/enforcement/flujo crítico.
- [x] RLS activado en ambas tablas nuevas (`permiso`, `rol_permiso`), sin policies anon/authenticated, coherente con login.
- [x] Migración versionada y reversible: `migration.sql` + `down.sql`; `init.sh` valida down.sql.
- [x] Sin secretos hardcodeados.
- [x] Webhooks: N/A.
- [x] Capas: solo Repository (sin lógica de negocio) + interfaces en `lib/interfaces/repositories/`. No hay Service porque no hay lógica; correcto para el alcance.
- [x] Permisos/UI: N/A — no se tocó `app/` ni `components/` (git status confirma).
- [x] Multi-país: sin hardcode de país/moneda/cuenta.
- [x] `./init.sh` verde.
- [x] `progress/review_permissions.md` existe (este archivo), veredicto APROBADO.
- [ ] Entrada en `progress/history.md`: pendiente del leader (fuera del alcance del reviewer).

## Alcance respetado

- Tabla `permiso` y pivote `rol_permiso` quedan VACÍAS: sin `INSERT` en `migration.sql`; `scripts/seed-catalogos.ts` sin permisos (test lo verifica). ✓
- Relación con `rol` es N:M mediante pivote explícita `RolPermiso` (PK compuesta `(rol_id, permiso_id)`), tal como el design. ✓
- Timestamps con default: `created_at` DEFAULT CURRENT_TIMESTAMP; `updated_at` gestionado por `@updatedAt`. ✓
- Migración con `down.sql` que dropea en orden inverso sin tocar tablas preexistentes. ✓
- RLS ENABLE en ambas tablas sin policies. ✓
- No se tocó UI ni se añadió seed de permisos (git status: solo `db/`, `lib/`, `tests/`, `specs/`, `progress/`). ✓

## Trazabilidad R1–R14 -> test

| R | Test | Estado |
| --- | --- | --- |
| R1 | permiso-repository.test.ts (crear + Permiso 6 columnas) + migration.test.ts "crea las tablas" | OK |
| R2 | permiso-repository.test.ts (assert: `id` no se pasa; lo genera `@default(uuid())`) | OK |
| R3 | permiso-repository.test.ts (nombre/method/route enviados) + DDL TEXT NOT NULL | OK |
| R4 | migration.test.ts "created_at DEFAULT CURRENT_TIMESTAMP" | OK |
| R5 | schema.prisma `@updatedAt` + migration.test.ts "updated_at NOT NULL"; bump real en UPDATE DIFERIDO (doc, como login) | OK (con deuda documentada) |
| R6 | migration.test.ts "UNIQUE INDEX (method, route)" | OK |
| R7 | rol-permiso-repository.test.ts (asocia + lee ambos lados N:M) | OK |
| R8 | migration.test.ts "PRIMARY KEY compuesta (rol_id, permiso_id)" | OK |
| R9 | migration.test.ts "FKs con ON DELETE CASCADE" | OK |
| R10 | migration.test.ts (sin INSERT) + seed sin permisos + count=0 | OK |
| R11 | migration.test.ts (sin INSERT) + seed sin rolPermiso + count=0 | OK |
| R12 | migration.test.ts "ENABLE ROW LEVEL SECURITY ambas tablas, sin CREATE POLICY" | OK |
| R13 | DDL RLS (mismo test); rechazo real con key anon DIFERIDO (doc, como login T004/T011) | OK (con deuda documentada) |
| R14 | migration.test.ts (down.sql: drop en orden inverso, no toca preexistentes); rollback vs DB real DIFERIDO | OK (con deuda documentada) |

Todos los R tienen test escrito y real (no vacío/tautológico). Los counts mockeados
(R10/R11) por sí solos serían débiles, pero están respaldados por asserts reales
sobre el DDL (sin INSERT) y sobre `seed-catalogos.ts`.

## Deuda diferida (aceptada)

Idéntica en naturaleza y documentación a la de login:
- R5: disparo real de `updated_at` en un UPDATE contra Postgres — DIFERIDO. Mecanismo (`@updatedAt`) en schema; test de columna presente.
- R13: rechazo efectivo con key `anon`/`authenticated` — DIFERIDO. DDL (ENABLE RLS sin policies) verificado.
- T013/R14: `db:rollback` + `db:migrate` sin diff contra DB real — DIFERIDO (no hay datasource url en el entorno). `down.sql` verificado por assert de DDL.

Ninguna deuda oculta un requisito sin test escrito: todas tienen cobertura
code/DDL-level y quedan explícitas para verificación al desplegar.

## Hallazgos

- (menor) Los tests de `contar()` (R10/R11) mockean Prisma devolviendo 0, por lo
  que aislados son tautológicos; la cobertura real de "tabla vacía" la aportan los
  asserts de "sin INSERT" y "seed sin permisos". No bloqueante.
- (menor) Se agregaron repositorios/interfaces (`PermisoRepository`,
  `RolPermisoRepository`) no mencionados explícitamente en el design (que solo
  citaba modelo de datos). Son inocuos, respetan el patrón de capas y habilitan
  tests code-level. No bloqueante.

## Bloqueantes

Ninguno.
