# Feature 101 — Prioridad de reasignación — mapa R→test

> Ciclo SDD directo del leader (`model:opus`): spec_author → gate F1.4 (humano, las 5 recomendadas +
> prop `rowClassName`) → backend_dev → frontend_dev (cayó por límite de sesión a mitad de T10;
> **el leader retomó y cerró el frontend restante: test R10 de no-fuga + helper `PrioridadResalte`**)
> → reviewer **APROBADO de código** (RECHAZADO inicial SOLO por artefactos de trazabilidad —este
> archivo, tasks sin marcar, tabla R→test, test de migración—, sin cambios de código de dominio).
> Rama `feature/101-prioridad-reasignacion`.

## Verificación (medida, independiente: implementer + reviewer + leader)
- `pnpm typecheck` → **0** · `pnpm lint` → **0 err** (143 warn preexistentes)
- `pnpm test` → **4050/4050** (408 archivos; el `no-embalaje` es flaky ambiental, pasa aislado)
- **Round-trip REAL de la migración** `20260722120000_orden_prioridad` contra Postgres local (DB
  desechable): `prioridad` PRESENT (`boolean NOT NULL DEFAULT false`) → `db:rollback` → **ABSENT** →
  `migrate deploy` → PRESENT + `migrate status` up to date. Ejecutado por el reviewer; DB restaurada.
- `./init.sh` ROJO por deuda AJENA preexistente (chequeo de specs de features legacy cuyo `name` no
  mapea a su carpeta), medido idéntico en el commit base; no atribuible a la 101.

## Gate F1.4 (respetado; verificado por el reviewer de forma adversarial)
- **Q1 apagar:** `prioridad: false` en `OrdenRepository.asignarBodegaLote` (central) y `asignarSateliteLote`
  (satélite), en la misma escritura de asignación. `generarGuiaLote` intacto (y gateado a
  `en_fulfillment`/`en_preparacion`, no puede recibir un `en_bodega` prioritario).
- **Q2 encender:** `prioridad: true` en el `updateMany` de `DevolucionSlaRepository.liberarDevueltaSla`
  (99), dentro de la guarda `estatus_id=devuelta`. El **escalado** y la **recuperación manual** (100)
  NO encienden prioridad (R3), afirmado por test negativo (`not.toHaveProperty("prioridad")`).
- **Sort:** `prioridad desc` + orden vigente en `OrdenRepository.list` (apartado `en_bodega`) y
  `findRecepcionSateliteByZona` (grupo `recibidas`). Inocuo fuera de bodega (todo `false`).
- **Q3 resalte:** SOLO tab `en_bodega` de `/ordenes` (gateado en `OrdenesTabs`, prop `resaltarPrioridad`)
  y grupo "Recibidas" de `/recepcion-satelite`. NO en /novedades, "Devueltas" (100) ni portal del
  mensajero (R10). Marcador accesible: badge "Prioritaria" (no solo color).
- **Q4:** sin backfill (default false). **`rowClassName`** en `DataTable` opcional/retrocompatible.

## Helper compartido
`components/shared/PrioridadResalte.tsx` concentra las 3 piezas del resalte (clase `bg-warning/15`
contrast-safe, badge "Prioritaria", decorador de columnas), reusadas idénticas por ambas superficies.

## Mapa R→test

| R | Requisito | Test |
|---|-----------|------|
| R1 | columna `orden.prioridad` BOOLEAN NOT NULL DEFAULT false | `tests/integration/db/orden-prioridad-migration.test.ts` |
| R2 | el cron SLA la enciende al liberar (`liberarDevueltaSla`) | `tests/unit/repositories/devolucion-sla-repository.test.ts` |
| R3 | escalado y recuperación manual NO la encienden | `tests/unit/repositories/devolucion-sla-repository.test.ts` (escalar) + `tests/unit/repositories/recuperacion-bodega-repository.test.ts` |
| R4 | liberar `count=0` → no-op | `tests/unit/repositories/devolucion-sla-repository.test.ts` |
| R5 | se apaga al asignar mensajero desde bodega (ambos puntos) | `tests/unit/repositories/orden-repository.guia.test.ts` + `orden-repository.asignacion-satelite.test.ts` |
| R6 | sort prioridad-first en `/ordenes` (`list`) | `tests/unit/repositories/orden-repository.test.ts` |
| R7 | sort prioridad-first en satélite (`findRecepcionSateliteByZona`) | `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` |
| R8 | resalte de fila + badge accesible | `tests/components/PrioridadResalte.test.ts` + `RecepcionSateliteModule.test.tsx` (R8) + `DataTable.test.tsx` |
| R9 | DTO propaga `prioridad` | `tests/unit/repositories/orden-repository.test.ts` + `orden-repository.recepcion-satelite.test.ts` + `tests/unit/services/recepcion-satelite-service.test.ts` |
| R10 | no-fuga a superficies ajenas | `tests/components/RecepcionSateliteModule.test.tsx` (R10) + gateo `en_bodega` en `OrdenesTabs` |
| R11 | sin backfill (históricas en false) | `tests/integration/db/orden-prioridad-migration.test.ts` |
| R12 | `down.sql` revierte (DROP COLUMN) | `tests/integration/db/orden-prioridad-migration.test.ts` + round-trip real (reviewer) |

## Nota de proceso
El `frontend_dev` cayó por límite de sesión de la API a mitad de T10 tras dejar hecho lo sustantivo
(prop `rowClassName`, resaltes en ambos módulos, helper compartido). El leader retomó: completó el
test R10 de no-fuga en `RecepcionSateliteModule.test.tsx`, creó `tests/components/PrioridadResalte.test.ts`
(las 3 piezas del helper aisladas) y el test de migración `orden-prioridad-migration.test.ts`.
