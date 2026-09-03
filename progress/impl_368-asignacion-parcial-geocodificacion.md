# Feature 368 — Implementación: mapa R → test

> Backend (T1/T3/T4/T7) commiteado en `9616897b` — *"feat(368): asignacion parcial en
> GuiaAsignacionService y AsignacionSateliteService (T1/T3/T4/T7)"*. Frontend (T2/T5/T6/T8) de
> esta entrada, sesión FRONTEND_DEV del 2026-09-03, worktree aislado `fix/368-asignacion-parcial-geocodificacion`.

## Q1 — texto exacto de los mensajes nuevos

**Q1 resuelto por el humano el 2026-09-03: aprobó el texto propuesto en `design.md` §6.3 tal cual.**

- Toast (éxito parcial): `Mensajero asignado a X de Y orden(es). Z bloqueada(s).`
- Detalle por orden bloqueada, `role="alert"`: `{numRemision} — {mensaje}`

Implementado literalmente así en `AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx`
(`handleConfirm`), sin ninguna variación entre los dos modales (R5).

## Trazabilidad — R → test

| R | Qué exige | Test(s) |
| --- | --- | --- |
| R1 | central: asigna asignables, no toca bloqueadas cuando hay mezcla | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` — `it.each(NO_ASIGNABLES)("motivo %s -> partial: asigna la asignable, reporta la bloqueada", ...)` (describe `"R8 — asignarDesdeBodega..."`) y `"368/R1: lote de 3 con la bloqueada al medio preserva el orden en ambos arrays"` |
| R2 | satélite: mismo comportamiento que R1 | `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` — `it.each(NO_ASIGNABLES)("motivo %s -> partial: asigna la asignable, reporta la bloqueada", ...)` (describe `"R8 — AsignacionSateliteService.asignar"`) |
| R3 | ninguna asignable → fallo total, sin cambios | `guia-asignacion-gate-coordenadas.test.ts` — `"368/R3: las DOS ordenes bloqueadas por coordenadas -> conflict SIN persistir"` · `asignacion-satelite-gate-coordenadas.test.ts` — `"TODO-O-NADA: dos ordenes no asignables producen dos entradas y cero escrituras"` |
| R4 | todas asignables → éxito total, sin cambios | `guia-asignacion-gate-coordenadas.test.ts` — `"todas asignables -> persiste con normalidad"` · `asignacion-satelite-gate-coordenadas.test.ts` — `"todas asignables -> asigna con normalidad"` |
| R5 | mismo criterio y vocabulario en las dos bodegas | `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (los dos modales importan `mensajeDireccionPorMotivo` del mismo módulo) · `tests/components/AsignarSateliteModal.test.tsx` (describe `"AsignarSateliteModal — asignación parcial (368/R2/R10-R14)"`, espejo exacto de `AsignarBodegaModal.test.tsx`) |
| R6 | parcial SOLO por motivo de coordenadas | `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` — el filtro `asignables` solo consulta `detalleCoords` (gate de coordenadas), verificado por los mismos casos de R1-R4; ningún otro motivo de `DetalleConflicto` pasa por ese filtro (revisión de diff, sin cambios en `mensajePorMotivo`/`MOTIVOS_CON_CAUSA_PROPIA` de los dos mappers de error) |
| R7 | motivos de estado/pertenencia siguen todo-o-nada | No-regresión: `guia-asignacion-gate-coordenadas.test.ts` — `"el gate corre ANTES de resolver el catalogo de estados..."` y los tests de guardas ya existentes (no tocados por esta ficha) |
| R8 | motivos de mensajero/lote siguen todo-o-nada y antes del gate | `guia-asignacion-gate-coordenadas.test.ts` — `"feature 21: mensajero sin vehiculo asociado -> validation_error, sin persistir"` · `tests/unit/services/guia-asignacion-tope-intentos.test.ts` y `tests/unit/services/asignacion-satelite-tope-intentos.test.ts` (no tocados, siguen abortando antes del gate) |
| R9 | `generarGuia`/`rutearABodegaSatelite`/recolección sin cambios | Verificable por `git diff` del commit `9616897b`: no toca esos archivos ni sus tests. `guia-asignacion-gate-coordenadas.test.ts` — describe `"156/R12 — generarGuia YA NO pasa por el gate..."` sigue verde tal cual |
| R10 | identificador visible (`numRemision`) por orden bloqueada, nunca id/dirección | `tests/components/AsignarBodegaModal.test.tsx` — `"T5.1: partial (2 asignadas, 1 bloqueada) -> toast con los conteos y el detalle en el DOM"` (usa `numRemision` del `ordenes` prop del test) · espejo `AsignarSateliteModal.test.tsx` — `"T6.1"` |
| R11 | motivo en el vocabulario ya existente, por orden (no agregado) | `tests/unit/components/geocodificacion-motivo-messages.test.ts` — `describe("mensajeDireccionPorMotivo (368/R11)...")`, los cinco motivos + no-reconocido → `null` · `AsignarBodegaModal.test.tsx` T5.1 · `AsignarSateliteModal.test.tsx` T6.1 |
| R12 | conteo asignadas/bloqueadas en el mismo lugar que el éxito total | `AsignarBodegaModal.test.tsx` T5.1 (toast con los dos números) · `AsignarSateliteModal.test.tsx` T6.1 |
| R13 | manifiesto de las asignadas sigue disponible | `AsignarBodegaModal.test.tsx` / `AsignarSateliteModal.test.tsx` — no-regresión: `ManifiestoResultado` sigue recibiendo `seleccion={{ ordenIds: resultado.ordenIds }}`, y `resultado.ordenIds` sale de `result.resultados` (el subconjunto asignado) en ambos casos "ok" y "partial"; código revisado en `handleConfirm` |
| R14 | sin PII nueva (sin dirección, sin id interno) | `tests/unit/components/geocodificacion-motivo-messages.test.ts` (mensajes fijos, sin PII) · `AsignarBodegaModal.test.tsx` T5.1 / `AsignarSateliteModal.test.tsx` T6.1 (el DOM solo expone `numRemision` + mensaje fijo, nunca `direccion`/`id`) |
| R15 | tres desenlaces; parcial lleva ambos conjuntos | `lib/interfaces/services/IGuiaAsignacionService.ts` / `IAsignacionSateliteService.ts` / `lib/types/orden-guia.ts` / `lib/types/recepcion-satelite.ts` (compilación, `pnpm tsc --noEmit` verde) · `tests/integration/actions/ordenes-guia-action.test.ts` — `describe("asignarDesdeBodega — passthrough de \`partial\` (368/R15-R16)")` · `tests/integration/actions/asignacion-satelite-action.test.ts` — `"368/R15-R16: resultado de dominio \`partial\` pasa tal cual, sin envolverlo ni alterarlo"` |
| R16 | `conflict` conserva exactamente su forma | Mismos dos tests de integración de R15 (el passthrough no altera `conflict` tampoco) · compilación de T1 (ningún campo nuevo en la rama `conflict` de los cuatro tipos) |
| R17 | carrera de satélite: fallo total, con ambos motivos (coordenadas + carrera) | `asignacion-satelite-gate-coordenadas.test.ts` — `"368/R17: carrera compuesta — bloqueada por coordenadas + carrera en las asignables -> conflict con ambos motivos"` |
| R18 | supersede SOLO el motivo de coordenadas, resto sigue todo-o-nada | `design.md` §7-§8 (decisión documentada) · comentarios reescritos en `GuiaAsignacionService.ts` (`gateCoordenadas`, `asignarDesdeBodega`) y `AsignacionSateliteService.ts` (bloque `4b`, paso 7) en el commit `9616897b`; revisión de diff por el reviewer |
| R19 | comentarios "todo-o-nada" del motivo de coordenadas reescritos, con fecha y ficha | Revisión de diff del commit `9616897b` (criterio humano del reviewer) — los docstrings citados en `design.md` §8 ya no describen el motivo de coordenadas como todo-o-nada |

## Notas de implementación (frontend, esta entrada)

- `mensajeDireccionPorMotivo` (`app/(app)/_components/geocodificacion-motivo-messages.ts`) reusa
  el `MOTIVO_A_MENSAJE` ya existente — ningún vocabulario duplicado. `geocodificacionMotivoMessage`
  no se tocó (T2, no-regresión cubierta en el mismo archivo de test).
- `AsignarBodegaModal.tsx` / `AsignarSateliteModal.tsx`: `handleConfirm` suma `"partial"` a `"ok"`
  como resultado que NO lanza al canal de error del `Modal`; el `numRemision` de cada bloqueada se
  resuelve con `new Map(ordenes.map((o) => [o.id, o.numRemision]))` sobre el MISMO snapshot `ordenes`
  que generó los `ordenIds` enviados — nunca de un campo nuevo en `DetalleConflicto` (que sigue
  siendo `{ ordenId, motivo }`, sin ensanchar). `ManifiestoResultado` no se tocó: sigue recibiendo
  `seleccion={{ ordenIds: resultado.ordenIds }}`, que en `"partial"` ya es solo lo asignado.
- Guardia T8 (`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`):
  lee el código real de los dos modales (no una copia de su texto), confirma el import del mismo
  módulo y que ninguno cita los cinco literales de motivo como string propio, con contrapruebas en
  las dos direcciones (import ajeno / import ausente / literal copiado).

## Verificación ejecutada por FRONTEND_DEV (gate rápido de esta mitad)

- `pnpm typecheck` → verde, sin error nuevo.
- `pnpm lint` → 0 errores (149 warnings preexistentes, ninguno en archivos tocados por esta ficha).
- `pnpm exec vitest related --run` sobre los 7 archivos tocados (2 componentes, 1 módulo de
  mensajes, 4 archivos de test) → **450 tests verdes en 36 archivos**.
- Pendiente (fuera de este alcance): `./init.sh --rapido` / `./init.sh` completo los corre el
  leader antes del PR y tras el merge a `dev` (regla del arnés).
