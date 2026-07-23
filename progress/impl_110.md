# Bitácora de implementación — Feature 110: Prioridad de reasignación unificada

Zona: backend. Aditiva sobre la 101 (columna `orden.prioridad` ya existe). **Sin migración.**
Enciende `prioridad = true` en las otras dos vías de retorno a bodega para reasignar:
liberación de reprogramadas (46/90) y recuperación manual (100), replicando el patrón EXACTO
de la 101 (`DevolucionSlaRepository.liberarDevueltaSla`): una línea en el `data` del `updateMany`
ya existente y guardado por estado. Atómico, concurrencia-seguro, money-neutral.

## Decisiones del gate aplicadas (defaults aprobados)
- Q1 SÍ: la recuperación manual enciende prioridad (invierte 101/R3 para ese caso).
- Q2 sin exclusiones: todas las liberaciones a bodega van prioritarias.
- Q3 sin resalte diferenciado: fuera de alcance (100% reuso del consumo de la 101).

## Archivos modificados

### Código (capa Repository)
- `lib/repositories/LiberacionReprogramadaRepository.ts` — `liberarOrden`: agregado
  `prioridad: true` al `data` del `updateMany` guardado por `estatusId = reprogramada`
  (junto a `estatusId`, `mensajeroAsignadoId`, `asignadoAt`, `liberadaReprogramadaAt`).
  Doc del método ampliada (R1/R3/R4). **Sin** escritura extra ni cambio de `where`/append. (T1)
- `lib/repositories/RecuperacionBodegaRepository.ts` — `recuperarABodega`: agregado
  `prioridad: true` al `data` del `updateMany` guardado por `estatusId = devuelta`.
  Comentarios stale corregidos (doc de clase + del método: antes decían "la recuperación
  MANUAL NO enciende prioridad"; ahora reflejan la 110). (T2/T3)
- `lib/repositories/DevolucionSlaRepository.ts` — SOLO comentario: la nota de
  `liberarDevueltaSla` que decía "la recuperación MANUAL de la feature 100 NO toca prioridad"
  quedó stale; se actualizó a la realidad de la 110 (el único retorno excluido es el escalado a
  `rechazada`). Sin cambio funcional. (T3)

### Tests
- `tests/unit/repositories/liberacion-reprogramada-repository.test.ts` — TIGHTEN del
  `.toEqual` del `data` para incluir `prioridad: true` (R1/R6) + nuevo caso R1/R4 (una sola
  llamada a `orden.updateMany`, `data.prioridad === true`). (T4)
- `tests/unit/repositories/recuperacion-bodega-repository.test.ts` — TIGHTEN del `.toEqual`
  del `data` para incluir `prioridad: true`; FLIP del caso que afirmaba "NO enciende prioridad"
  → ahora afirma que SÍ la enciende dentro del único `updateMany.data` (R2/R4). Header
  actualizado. (T5/T7)
- `tests/integration/db/resolver-novedad-recupera-sla.test.ts` — `OrdenRow.prioridad`
  añadido (init `false`); aserción `prioridad === true` tras `recuperarABodega` en ambos
  destinos (central y satélite), con el repo REAL. (T11)
- `tests/integration/db/resolver-novedad-reprograma-sla.test.ts` — `OrdenRow.prioridad`
  añadido (init `false`); nuevo caso que llama al repo REAL `liberarOrden` al llegar la fecha
  y afirma `prioridad === true` + destino `en_bodega` + handoff limpio. (T11)

### Desviación deliberada de tasks.md (T11)
La task nombraba `tests/integration/actions/liberar-reprogramadas-route.test.ts` para la
integración de la liberación de reprogramadas, pero ese test mockea el service completo
(fake `ejecutarLiberacion`) y NUNCA ejecuta el repositorio, por lo que no puede observar
`prioridad`. Para dar trazabilidad REAL de R1 end-to-end extendí en su lugar
`tests/integration/db/resolver-novedad-reprograma-sla.test.ts`, que ya usa el
`LiberacionReprogramadaRepository` real. El route test queda intacto (sigue verde).

## R5 — Sin migración (verificado)
`git status` no muestra cambios en `db/` (ni nuevo dir en `db/migrations/`, ni
`db/schema.prisma`). La columna `orden.prioridad` de la 101 se reutiliza tal cual.

## Mapa R → test

| Req | Test |
| --- | --- |
| R1  | `tests/unit/repositories/liberacion-reprogramada-repository.test.ts` (`data` incluye `prioridad: true`; caso R1/R4 dedicado) · integración `resolver-novedad-reprograma-sla.test.ts` (liberarOrden real → `prioridad=true`) |
| R2  | `tests/unit/repositories/recuperacion-bodega-repository.test.ts` (`data` incluye `prioridad: true`) · integración `resolver-novedad-recupera-sla.test.ts` (recuperarABodega real → `prioridad=true`, central + satélite) |
| R3  | `recuperacion-bodega-repository.test.ts` (count 0 → false, sin append) · `liberacion-reprogramada-repository.test.ts` (count 0 → false, sin append) · integración `resolver-novedad-recupera-sla.test.ts` (2.ª recuperación no-op) |
| R4  | ambos repo-tests: `prioridad` dentro del ÚNICO `updateMany.data` (`toHaveBeenCalledTimes(1)`, sin segunda escritura) |
| R5  | `git status` sin cambios en `db/` (sin migración/schema); columna 101 reusada |
| R6  | ambos repo-tests: `.toEqual` del `data` completo (resto de campos intactos) + append (actor/`origen_tipo`) sin cambios |
| R7  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (`liberarDevueltaSla` → `prioridad: true`, sin regresión) |
| R8  | `tests/unit/repositories/orden-repository.guia.test.ts` + `orden-repository.asignacion-satelite.test.ts` (`prioridad = false` al asignar, sin regresión) |
| R9  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (`escalarDevueltaSla` → `not.toHaveProperty("prioridad")`) |
| R10 | `tests/unit/repositories/orden-repository.test.ts` + `orden-repository.recepcion-satelite.test.ts` (`orderBy` prioridad-first intacto, sin cambio de listado) |

## Verificación ejecutable

### `pnpm run typecheck`
```
> tsc --noEmit
(sin salida — OK)
```

### `pnpm run lint`
```
✖ 144 problems (0 errors, 144 warnings)
```
0 errores. Los 144 warnings son preexistentes; ninguno cae en archivos tocados por la 110.

### Tests tocados + regresión
```
# 5 archivos tocados/agregados:
Test Files  5 passed (5)
      Tests  30 passed (30)
# regresión orden-repository (R8/R10):
Test Files  4 passed (4)
      Tests  76 passed (76)
```

### `pnpm test` (suite completa)
```
Test Files  1 failed | 451 passed (452)
      Tests  1 failed | 4482 passed (4483)
```
El ÚNICO rojo es `tests/integration/db/zonas-migration.test.ts` (allow-list de migraciones,
deuda preexistente AJENA; la 110 no agrega migración). No cayó ningún flaky de esta corrida
(HomePage/HomePageRol/OrdenesModuleReuse/CierreDiaPage pasaron).

## Veredicto
Feature 110 cerrada en backend: reprogramadas y recuperadas encienden `prioridad` en la misma
escritura guardada por estado (patrón 101), sin migración, sin regresión. typecheck y lint
verdes; suite verde salvo 1 rojo AJENO conocido (zonas-migration). Sin bloqueantes.
