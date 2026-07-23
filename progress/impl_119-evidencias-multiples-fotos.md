# Impl 119 — Evidencias de gestión: de 1 a 1..N fotos (parte BACKEND)

> Rama: `feature/119-evidencias-multiples-fotos` · zona backend (Bloques A, B, y tests backend del D).
> Máximo de fotos = **3** (gate F1.4, `GESTION_MAX_EVIDENCIAS`, default 3).
> **La parte FRONTEND (T11: `GestionarOrdenPanel` multi-select/previews/quitar, R14–R17) queda
> PENDIENTE para `frontend_dev`.** No se tocó ningún `.tsx`.

## Alcance entregado

Bloque A (BD), Bloque B (contrato + service + borde) y los tests backend del Bloque D
(T12/T13). T1–T10, T12, T13 marcadas `[x]` en `tasks.md`; T11 (frontend) sigue `[ ]`.

## Archivos creados

- `db/migrations/20260723130000_gestion_orden_evidencia/migration.sql` — tabla 1:N,
  `@@unique(gestion_id, indice)`, index, FK `ON DELETE CASCADE`, RLS habilitada sin policies,
  backfill de la portada (índice 0) desde `evidencia_storage_path` con fallback `image/jpeg`.
- `db/migrations/20260723130000_gestion_orden_evidencia/down.sql` — `DROP TABLE` (no toca `gestion_orden`).
- `tests/integration/db/gestion-orden-evidencia-migration.test.ts` — estático (R1–R4).
- `tests/unit/types/gestion-orden-evidencias-schema.test.ts` — schema (R5–R8) + bridge.
- `tests/unit/repositories/gestion-orden-evidencia.test.ts` — repo (R9/R12/R2).
- `tests/unit/services/mis-asignaciones-evidencias.test.ts` — service atomicidad/compensación (R9/R10/R11/R13).
- `tests/unit/actions/mis-asignaciones-evidencias.test.ts` — borde `getAll`/`leerEvidencias` (R5–R8).

## Archivos modificados (código)

- `db/schema.prisma` — modelo `GestionOrdenEvidencia` + inverso `evidencias` en `GestionOrden`.
- `lib/config/gestion.ts` — `MAX_EVIDENCIAS_POR_GESTION` (`readPositiveInt("GESTION_MAX_EVIDENCIAS", 3)`).
- `lib/interfaces/services/IMisAsignacionesService.ts` — `GestionarInput.evidencias: EvidenciaArchivo[]`
  (3 ramas con foto), `GestionarServiceResult.evidenciaUrls?: string[]`.
- `lib/interfaces/repositories/IGestionOrdenRepository.ts` — `GestionOrdenData.evidencias?` (singulares conservados).
- `lib/types/gestion-orden.ts` — `evidenciasSchema` (min 1 / max N), ramas `evidencia`→`evidencias`,
  `GestionarResult.evidenciaUrls?`, y **bridge** `foldEvidenciaSingular` (ver nota).
- `lib/repositories/GestionOrdenRepository.ts` — `GestionPrismaClient` + `gestionOrdenEvidencia`;
  en `crearGestionYTransicionar`, dentro del MISMO `$transaction`: dual-write de la portada (índice 0)
  en las columnas viejas + `createMany` de las N filas hijas.
- `lib/services/MisAsignacionesService.ts` — subida SECUENCIAL con acumulación en `uploaded` y
  compensación `storage.remove(uploaded)` ante fallo de subida (R10) o de tx (R11);
  `buildGestionData(input, evidencias)`; `evidenciaUrls` vía `createSignedUrls`.
- `lib/actions/mis-asignaciones.ts` — `getAll("evidencia")` → `raw.evidencias`; `leerEvidencias`;
  `toGestionarInput` pasa `evidencias`.

## Archivos modificados (tests existentes, por el rename de contrato)

`evidencia`→`evidencias` y `evidenciaUrl`→`evidenciaUrls` son cambios de contrato de la 119; se
ajustaron los tests backend que los usaban:
- `tests/unit/services/mis-asignaciones-service.test.ts`, `tests/unit/services/mis-asignaciones-causa-devolucion.test.ts`
- `tests/unit/actions/mis-asignaciones-action.test.ts`, `tests/unit/actions/mis-asignaciones-causa-devolucion.test.ts`
- `tests/unit/types/gestion-orden-schemas.test.ts`, `tests/unit/types/gestion-orden-causa-devolucion.test.ts`
- `tests/integration/db/zonas-migration.test.ts` — exclusión de la migración nueva del check de orden
  (convención ya usada por features 101/104/106/107/109/115/118).

## Nota: bridge de entrega escalonada (por qué el panel sin migrar sigue vivo)

El panel (`GestionarOrdenPanel.tsx`) valida en cliente con el MISMO `gestionarSchema` y hoy envía el
campo SINGULAR `evidencia`. Como T11 (frontend) va DESPUÉS y NO se toca ningún `.tsx`, el schema
pliega `evidencia`→`evidencias` (`foldEvidenciaSingular`) para que el panel sin migrar y sus tests de
componente (`tests/components/MisAsignacionesModule.test.tsx`, no editables) sigan verdes. El borde ya
arma `evidencias` con `getAll("evidencia")`. Al migrar, el panel debe pasar a `evidencias` /
`append("evidencia", …)` por foto. La clave de error de "sin foto" pasa a colgar de `evidencias`.

## Trazabilidad R → test (R backend R1–R13)

| R | Test |
| -- | --- |
| R1 | `gestion-orden-evidencia-migration.test.ts` (CREATE TABLE + columnas + FK CASCADE) · `gestion-orden-evidencia.test.ts` (createMany N filas) |
| R2 | `gestion-orden-evidencia-migration.test.ts` (UNIQUE `(gestion_id, indice)`) · `gestion-orden-evidencia.test.ts` ("preserva el indice 0..N-1") |
| R3 | `gestion-orden-evidencia-migration.test.ts` (backfill `WHERE evidencia_storage_path IS NOT NULL … indice 0`; no inventa filas) |
| R4 | `gestion-orden-evidencia-migration.test.ts` (RLS `ENABLE` sin `CREATE POLICY`; down `DROP TABLE` sin tocar `gestion_orden`) |
| R5 | `gestion-orden-evidencias-schema.test.ts` ("las 3 ramas aceptan lista 1..MAX"; reprogramada sin foto) · `mis-asignaciones-evidencias.test.ts` (action: getAll → N) |
| R6 | `gestion-orden-evidencias-schema.test.ts` ("lista vacía / ausente → error `evidencias`") · `mis-asignaciones-evidencias.test.ts` (action: sin foto → validation_error) |
| R7 | `gestion-orden-evidencias-schema.test.ts` ("MAX+1 → inválido"; MAX=3) · `mis-asignaciones-evidencias.test.ts` (action: 4 fotos → validation_error) |
| R8 | `gestion-orden-evidencias-schema.test.ts` ("una foto no-imagen / sobre tamaño entre válidas → inválido") · `mis-asignaciones-evidencias.test.ts` (action: pdf → validation_error) |
| R9 | `gestion-orden-evidencia.test.ts` (gestión + createMany N + update en un `$transaction`) · `mis-asignaciones-evidencias.test.ts` (service pasa indices 0..N-1 en orden) |
| R10 | `mis-asignaciones-evidencias.test.ts` ("falla subida #k → remove(k-1) previas, repo NO invocado"; primera subida falla → sin remove) |
| R11 | `mis-asignaciones-evidencias.test.ts` ("tx lanza → remove(N) y propaga") |
| R12 | `gestion-orden-evidencia.test.ts` ("índice 0 → evidencia_storage_path/_content_type en el mismo insert"; portada correcta aun desordenada) |
| R13 | `mis-asignaciones-evidencias.test.ts` ("N URLs firmadas por `createSignedUrls`, nunca path/bucket crudo"; reprogramada → undefined) |

R14–R17 (frontend): **pendientes**, los cubrirá `frontend_dev` con el test de componente de T11.

## Verificación (salida real)

- `pnpm run typecheck` → sin errores (tsc --noEmit, salida vacía).
- `pnpm run lint` → `✖ 143 problems (0 errors, 143 warnings)` — 0 errores; todos los warnings son
  preexistentes (ninguno en el código/tests de la 119).
- `pnpm test` (vitest run) → `Test Files 464 passed (464)` · `Tests 4625 passed (4625)`.
- `./init.sh` → `== init OK ==` (verde; typecheck + lint + test + down.sql de todas las migraciones).

## Veredicto

Backend de la 119 completo y verde (contrato 1..N, atomicidad storage↔DB con compensación,
migración + RLS + backfill, tope 3); falta solo la parte frontend (T11/R14–R17) para `frontend_dev`.
