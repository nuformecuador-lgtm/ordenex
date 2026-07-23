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

## Veredicto (backend)

Backend de la 119 completo y verde (contrato 1..N, atomicidad storage↔DB con compensación,
migración + RLS + backfill, tope 3); falta solo la parte frontend (T11/R14–R17) para `frontend_dev`.

---

# Impl 119 — parte FRONTEND (T11, R14–R17)

> Zona frontend. Migra `GestionarOrdenPanel` de la foto ÚNICA a la LISTA de 1..N fotos (tope 3).
> `./init.sh` verde. No se tocó backend, migraciones ni service.

## Archivos tocados (frontend)

**Modificados (código):**
- `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` — estado
  `evidencia: File | null` → `evidencias: File[]` (`[]` inicial); nuevo componente local
  `EvidenciasField` (input `multiple`, previews con `URL.createObjectURL` + revoke, botón
  "Quitar evidencia N", hint de tope) reusado en las 3 ramas con foto; `handleEvidenciaChange`
  comprime cada archivo (`comprimirImagen`) y **concatena** al array, recortando a
  `MAX_EVIDENCIAS_POR_GESTION` y marcando error de campo si excede (R16); `quitarEvidencia(index)`
  (R15); `buildRaw` pasa `evidencias`; `buildFormData` hace `append("evidencia", foto)` por foto;
  `handleConfirm` sigue validando con `gestionarSchema.safeParse` (R16/R17, min 1 / max 3);
  `elegirResultado` resetea `evidencias` a `[]`. La clave de error de foto pasó de `evidencia` a
  `evidencias`. `reprogramada` sin cambios.
- `lib/types/gestion-orden.ts` — **retirado el puente `foldEvidenciaSingular`**; `gestionarSchema`
  ahora es la unión directa (`gestionarUnionSchema`), sin `z.preprocess`.
- `tests/setup/jest-dom.ts` — polyfill benigno de `URL.createObjectURL`/`revokeObjectURL` para
  jsdom (los usa el panel para previsualizar); URLs únicas para no colisionar `key`s de lista.

**Nuevos (tests):**
- `tests/components/GestionarOrdenPanelEvidencias.test.tsx` — R14/R15/R16/R17.

**Modificados (tests, por el retiro del puente / cambio de clave de error):**
- `tests/unit/types/gestion-orden-schemas.test.ts`, `tests/unit/types/gestion-orden-causa-devolucion.test.ts`
  — el campo singular `evidencia` de los fixtures pasa a la lista `evidencias: [...]`.
- `tests/unit/types/gestion-orden-evidencias-schema.test.ts` — el bloque "bridge" (que probaba el
  plegado singular) se reemplaza por "sin puente: el campo singular ya no se pliega → inválido".
- `tests/components/MisAsignacionesModule.test.tsx` — el mock de `validation_error` del servidor
  usa la clave `evidencias` (el borde revalida con el mismo schema).

## Qué pasó con el puente `foldEvidenciaSingular`

**ELIMINADO.** Tras migrar el panel, los únicos consumidores de `gestionarSchema` son (1) el panel,
que en su `safeParse` construye `evidencias: File[]`, y (2) la Server Action, que arma
`raw.evidencias` con `getAll("evidencia")`. Ningún consumidor de producción envía ya el campo
singular `evidencia` al schema, así que el plegado quedó como código muerto y se retiró. La clave
`evidencia` sigue siendo la del FormData (N valores, misma clave) — eso NO cambió; lo que se retiró
es solo el fold del OBJETO de zod. Los tests del schema que se apoyaban en el puente se ajustaron al
contrato de lista.

## Trazabilidad R14–R17 → test

| R | Test |
| -- | --- |
| R14 | `GestionarOrdenPanelEvidencias.test.tsx`: "el input permite selección MÚLTIPLE en las 3 ramas" (attr `multiple`), "la selección se CONCATENA", "cada foto viaja como un valor de la clave `evidencia` (getAll → N)" |
| R15 | `GestionarOrdenPanelEvidencias.test.tsx`: "seleccionar varias fotos muestra una previsualización por cada una", "'Quitar' elimina esa foto de la lista y revoca su object URL" |
| R16 | `GestionarOrdenPanelEvidencias.test.tsx`: "seleccionar MÁS del tope (3) recorta a 3 y marca el error, sin llamar la action", "tras recortar y quitar una foto, se puede enviar con las 3 permitidas" |
| R17 | `GestionarOrdenPanelEvidencias.test.tsx`: "sin ninguna foto, 'Guardar gestión' NO llama la action y muestra el error de campo" |

## Verificación (salida real)

- `pnpm run typecheck` → sin errores (tsc --noEmit, salida vacía).
- `pnpm run lint` → `✖ 143 problems (0 errors, 143 warnings)` — 0 errores; los warnings son
  preexistentes (el `<img>` de la preview lleva `eslint-disable-next-line @next/next/no-img-element`,
  convención ya usada por los módulos de cierre; el efecto de previews usa `useMemo`, sin
  `setState`-en-efecto).
- `pnpm test` (vitest run) → `Test Files 465 passed (465)` · `Tests 4632 passed (4632)`.
- `./init.sh` → `== init OK ==` (verde: typecheck + lint + test + down.sql).

## Veredicto (frontend)

Panel migrado a evidencias múltiples (1..3 fotos) con previews/quitar/tope y bloqueo de envío;
puente `foldEvidenciaSingular` retirado; suite completa verde.
