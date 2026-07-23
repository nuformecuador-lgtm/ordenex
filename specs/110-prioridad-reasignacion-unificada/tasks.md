# Feature 110 — Tasks

Orquestable como **backend_dev** (zona backend, sin frontend: el consumo/resalte ya existe en la
101). Cada task marcada `[B]` (backend). `[P]` = paralelizable con las de su mismo bloque. Criterio
de "hecho" por task. Sin migración.

## Implementación

- [x] **T1 [B] [P] — Encender `prioridad` en la liberación de reprogramadas.**
  En `lib/repositories/LiberacionReprogramadaRepository.ts` → `liberarOrden`, agregar
  `prioridad: true` al `data` del `updateMany` (guardado por `estatusId = reprogramada`). No tocar
  el `where`, ni `appendCambioEstado`, ni `liberadaReprogramadaAt`.
  *Hecho:* el `data` incluye `prioridad: true`; el resto del método sin cambios; `typecheck` OK.

- [x] **T2 [B] [P] — Encender `prioridad` en la recuperación manual.**
  En `lib/repositories/RecuperacionBodegaRepository.ts` → `recuperarABodega`, agregar
  `prioridad: true` al `data` del `updateMany` (guardado por `estatusId = devuelta`). No tocar el
  `where`, ni el actor/`origen_tipo` del `appendCambioEstado`.
  *Hecho:* el `data` incluye `prioridad: true`; append intacto; `typecheck` OK.

- [x] **T3 [B] [P] — Corregir comentarios stale.**
  Actualizar la doc de `RecuperacionBodegaRepository.recuperarABodega` (hoy dice "NO enciende
  prioridad") y la nota de `DevolucionSlaRepository.liberarDevueltaSla` (hoy dice "la recuperación
  MANUAL NO toca prioridad") para reflejar la 110. Sin cambio funcional en `DevolucionSlaRepository`.
  *Hecho:* ambos comentarios coherentes con el nuevo comportamiento.

## Tests (depende de T1/T2/T3)

- [x] **T4 [B] — Test R1: reprogramada enciende prioridad.**
  En `tests/unit/repositories/liberacion-reprogramada-repository.test.ts`, aserción de que
  `liberarOrden` incluye `prioridad: true` en `data` (y el resto de campos siguen presentes: R6).
  *Hecho:* test verde.

- [x] **T5 [B] — Test R2 + ajustar `.toEqual`: recuperación enciende prioridad.**
  En `tests/unit/repositories/recuperacion-bodega-repository.test.ts`, TIGHTEN la aserción existente
  `expect(upd.data).toEqual({ estatusId, mensajeroAsignadoId: null, asignadoAt: null })` para incluir
  `prioridad: true` (no aflojar a `toMatchObject`), y flip del caso que hoy verifica "NO enciende".
  *Hecho:* test verde con el `data` completo incl. `prioridad: true`.

- [x] **T6 [B] [P] — Test R3: idempotencia (count = 0 no toca prioridad).**
  En ambos repo-tests, caso `updateMany` con `count: 0` → retorna `false`, sin `appendCambioEstado`;
  la guarda por estado impide reencender.
  *Hecho:* ambos casos verdes.

- [x] **T7 [B] [P] — Test R4/R6: encendido atómico y money-neutral.**
  Aserción de que `prioridad: true` va DENTRO del único `updateMany.data` (una sola llamada a
  `orden.updateMany`, sin segunda escritura) y que el resto del `data` y el append (actor/`origen_tipo`)
  no cambian.
  *Hecho:* verdes en ambos repo-tests.

- [x] **T8 [B] [P] — Regresión R7/R9 (SLA).**
  `tests/unit/repositories/devolucion-sla-repository.test.ts` sigue verde: `liberarDevueltaSla` con
  `prioridad: true` (R7) y `escalarDevueltaSla` sin `prioridad` (R9, `not.toHaveProperty`).
  *Hecho:* sin regresión.

- [x] **T9 [B] [P] — Regresión R8 (apagado al reasignar).**
  `tests/unit/repositories/orden-repository.guia.test.ts` (`asignarBodegaLote` → `prioridad: false`) y
  `tests/unit/repositories/orden-repository.asignacion-satelite.test.ts` (`asignarSateliteLote` →
  `"prioridad" = false`) siguen verdes.
  *Hecho:* sin regresión.

- [x] **T10 [B] [P] — Regresión R10 (consumo/sort intacto).**
  `tests/unit/repositories/orden-repository.test.ts` (`orderBy[0] = { prioridad: "desc" }`) y
  `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` siguen verdes; no se modificó
  la lógica de listado.
  *Hecho:* sin regresión.

- [x] **T11 [B] — Integración: prioridad tras cada retorno a bodega.**
  Verificar `prioridad = true` end-to-end en la recuperación manual
  (`tests/integration/db/resolver-novedad-recupera-sla.test.ts`, extender la aserción) y en la
  liberación de reprogramadas (`tests/integration/actions/liberar-reprogramadas-route.test.ts`,
  extender la aserción). Confirmar que R5 se cumple: sin nuevo directorio en `db/migrations/` y
  `db/schema.prisma` sin cambios (columna reusada).
  *Hecho:* integraciones verdes; `git status` sin migración nueva.

## Cierre

- [x] **T12 [B] — Suite y gate.**
  `pnpm run typecheck`, `pnpm run lint`, `pnpm test` verdes; `./init.sh` en verde. Escribir el mapa
  `R<n> → test` en `progress/impl_110.md`.
  *Hecho:* todo verde y mapa registrado.

## Mapa R → test

| Req | Test |
| --- | --- |
| R1  | `tests/unit/repositories/liberacion-reprogramada-repository.test.ts` (T4: `data` incluye `prioridad: true`) |
| R2  | `tests/unit/repositories/recuperacion-bodega-repository.test.ts` (T5: `data` incluye `prioridad: true`) |
| R3  | ambos repo-tests (T6: `count = 0` → `false`, sin append, prioridad no reencendida) |
| R4  | ambos repo-tests (T7: `prioridad` dentro del único `updateMany.data`, sin segunda escritura) |
| R5  | T11 (sin nuevo dir en `db/migrations/`; `db/schema.prisma` sin cambios; columna 101 reusada) |
| R6  | ambos repo-tests (T7: resto de `data` + actor/`origen_tipo` del append sin cambios) |
| R7  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (T8: `liberarDevueltaSla` `prioridad: true`) |
| R8  | `tests/unit/repositories/orden-repository.guia.test.ts` + `orden-repository.asignacion-satelite.test.ts` (T9: `prioridad = false` al asignar) |
| R9  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (T8: `escalarDevueltaSla` `not.toHaveProperty("prioridad")`) |
| R10 | `tests/unit/repositories/orden-repository.test.ts` + `orden-repository.recepcion-satelite.test.ts` (T10: `orderBy` prioridad-first intacto) |
