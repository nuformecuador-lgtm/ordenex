# Review 119 — Evidencias de gestión: de 1 a 1..N fotos (máx 3)

> Reviewer del arnés SDD. Rama `feature/119-evidencias-multiples-fotos`. Diff vs `origin/dev...HEAD`.
> NO se editó código; solo verificación y veredicto.

## Veredicto: **APROBADO** (sin hallazgos bloqueantes)

Suite (corrida por el reviewer, no la bitácora):
- `typecheck` → verde (tras `prisma generate`; el worktree limpio traía cliente Prisma stale).
- `lint` → 0 errores, 143 warnings preexistentes (ninguno en código/tests de la 119).
- `test` (vitest run) → 4631 passed / 1 failed (4632). El único fallo es
  `tests/components/Modal.test.tsx > R30 focus-trap`, AJENO a la 119 (Modal.test.tsx no está en el
  diff) y FLAKY: en aislamiento pasa 45/45. Es sensibilidad de foco de jsdom bajo paralelismo, no
  una regresión de esta feature.
- Test files propios de la 119 corridos juntos → **6 files / 58 tests, todos verdes**.

## Checklist del arnés

- [x] `specs/119/{requirements,design,tasks}.md` presentes; design con alternativa descartada
      (drop-and-repoint) y su porqué. Todas las tasks T1–T15 marcadas `[x]`.
- [x] Trazabilidad: cada R1–R17 mapea a ≥1 test real con asserts (tabla abajo).
- [x] `progress/impl_119...md` contiene el mapa R→test (backend y frontend).
- [x] typecheck / lint / test verdes (salvo flaky ajeno documentado arriba).
- [x] Tabla nueva `gestion_orden_evidencia` con RLS habilitada sin policies (R4).
- [x] Migración versionada y reversible: `migration.sql` + `down.sql` (DROP TABLE, no toca `gestion_orden`).
- [x] Sin secretos hardcodeados; tope de negocio por env (`GESTION_MAX_EVIDENCIAS`, default 3).
- [x] Capas separadas: borde (action) → service (compensación/atomicidad) → repo (Prisma en `$transaction`).
- [x] No es webhook; no aplica firma/idempotencia.
- [x] Multi-país: nada de país/moneda/cuenta hardcodeado (no aplica a esta feature).
- [x] Sin `console.log` de PII ni `any` injustificado en `lib/**` ni `app/**` (grep del diff, 0 matches).
- [x] Sin fugas de `createObjectURL`: `useMemo` deriva previews y `useEffect` cleanup revoca al
      cambiar la lista (quitar) y al desmontar.
- [x] Consumidores de la portada (cierres 37/38/40, API 106) NO cambiaron: ausentes del diff; siguen
      leyendo `evidencia_storage_path/_content_type` (dual-write índice 0, R12).
- [x] Puente `foldEvidenciaSingular` ELIMINADO: sin referencias en código de producción; el panel
      envía `evidencias` / `append("evidencia", …)` por foto; ningún consumidor manda el campo singular.
- [x] E2E crítico (`e2e/mis-asignaciones.spec.ts`) sigue válido: usa `getByLabel("Foto de evidencia
      de entrega/rechazo")` (aria-labels PRESERVADOS) + `setInputFiles` de 1 archivo sobre input `multiple`.

## Trazabilidad R → test (archivo)

| R | Verifica | Test |
| -- | --- | --- |
| R1 | tabla + columnas + FK CASCADE | `gestion-orden-evidencia-migration.test.ts` (CREATE TABLE, FK ON DELETE CASCADE) + `gestion-orden-evidencia.test.ts` (createMany N filas) |
| R2 | `@@unique(gestion_id, indice)` + índice 0..N-1 | `...-migration.test.ts` (UNIQUE INDEX) + `gestion-orden-evidencia.test.ts` ("preserva el indice 0..N-1") |
| R3 | backfill `WHERE evidencia_storage_path IS NOT NULL` → indice 0, fallback content_type | `...-migration.test.ts` ("UNA fila indice 0 por gestion con path"; "no inventa filas") |
| R4 | RLS ENABLE sin CREATE POLICY; down DROP TABLE sin tocar gestion_orden | `...-migration.test.ts` (RLS; down no altera columnas de gestion_orden) |
| R5 | 3 ramas aceptan lista 1..MAX; reprogramada sin foto; getAll→N | `gestion-orden-evidencias-schema.test.ts` + `mis-asignaciones-evidencias.test.ts` (action) |
| R6 | lista vacía/ausente → error `evidencias`, sin subir/escribir | schema.test (vacía/ausente) + action.test ("sin foto → validation_error, service NO invocado") |
| R7 | MAX+1 → error; default 3 | schema.test ("MAX+1 inválido"; MAX===3) + action.test ("4 fotos → validation_error") |
| R8 | MIME/tamaño POR archivo | schema.test ("una foto no-imagen / sobre tamaño entre válidas → inválido") + action.test (pdf) |
| R9 | gestión + N evidencias + transición en UN `$transaction` | `gestion-orden-evidencia.test.ts` (un `$transaction` envuelve create+createMany+update) + service.test (indices 0..N-1) |
| R10 | falla subida #k → remove(k-1), repo NO invocado | `mis-asignaciones-evidencias.test.ts` ("borra SOLO las ya subidas y NO invoca al repo"; primera falla → sin remove) |
| R11 | tx lanza → remove(N) y propaga | `mis-asignaciones-evidencias.test.ts` ("remove con las N evidencias subidas") |
| R12 | portada índice 0 en columnas viejas, mismo insert | `gestion-orden-evidencia.test.ts` ("indice 0 → evidencia_storage_path/_content_type"; portada correcta aun desordenada) |
| R13 | `createSignedUrls` con TTL de config; nunca path/bucket crudo | `mis-asignaciones-evidencias.test.ts` (N URLs firmadas, no bucket; reprogramada → undefined) |
| R14 | multi-select en 3 ramas; concatena; getAll→N | `GestionarOrdenPanelEvidencias.test.tsx` (attr `multiple`; concatena; FormData N valores) |
| R15 | preview por foto + quitar + revoke | `GestionarOrdenPanelEvidencias.test.tsx` (previews; "Quitar" elimina y revoca objectURL) |
| R16 | tope + MIME bloquean envío sin action | `GestionarOrdenPanelEvidencias.test.tsx` ("MÁS del tope recorta a 3 y marca error, sin action"; enviar con 3) |
| R17 | sin foto en rama que la exige → bloquea | `GestionarOrdenPanelEvidencias.test.tsx` ("sin foto, Guardar NO llama la action, muestra error") |

## Hallazgos

- **menor** — El test de R13 (`mis-asignaciones-evidencias.test.ts`) afirma que se firma en lote con
  `createSignedUrls` y que la URL no contiene el bucket crudo, pero NO afirma explícitamente el
  argumento TTL. El código pasa `gestionConfig.SIGNED_URL_TTL_SECONDS` correctamente
  (`MisAsignacionesService.ts:380-382`). Cobertura suficiente; assert de TTL sería un plus.
- **menor** — En el navegador `MAX_EVIDENCIAS` cae al default 3 (la env `GESTION_MAX_EVIDENCIAS` no
  es `NEXT_PUBLIC`, no visible en cliente). Si algún día se sube el tope solo por env de servidor, el
  cap efectivo sería `min(cliente 3, server)`; el servidor revalida igual con el mismo schema. Con el
  default 3 (gate F1.4) no hay divergencia. Documentado en el panel (`GestionarOrdenPanel.tsx:51-53`).
- **menor (higiene de suite, ajeno a la 119)** — `tests/components/Modal.test.tsx > R30 focus-trap`
  es flaky bajo el paralelismo de la suite completa (pasa 45/45 en aislamiento). No lo introduce la
  119. Vale anotarlo como deuda de estabilidad de esa suite.
- **nota de entorno (no es defecto de código)** — En un worktree recién clonado, `typecheck` falla
  con `'@prisma/client' has no exported member 'Prisma'` hasta correr `prisma generate` (el
  postinstall se saltó los build scripts). Es el cliente Prisma stale ya conocido, no un problema de
  la feature. Tras generar, todo verde.

## Cierre

Contrato 1..N (tope 3) completo, atomicidad storage↔DB con compensación en ambos bordes (R10/R11),
migración + RLS + backfill + down reversible, dual-write de portada sin tocar consumidores viejos, y
panel migrado con previews/quitar/tope y puente singular eliminado. Trazabilidad R1–R17 completa con
tests de asserts reales. Sin hallazgos bloqueantes.

**APROBADO.**
