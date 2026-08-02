# Bitacora de implementacion — Feature 125 (backfill historico de analitica)

> Rama `feature/125-analitica-backfill-historico`, worktree `C:/w125`, sobre `origin/dev`
> @ `5314a2a8` (que ya incluye la 124, PR #260). Zona: backend.

## T1.1 — Baseline MEDIDO en esta rama y en esta sesion (2026-08-02)

No se cita ningun baseline ajeno: los de bitacora caducan con cualquier PR ajeno.

1. `pnpm db:generate` desde el schema limpio (el cliente generado sobrevive al cambio de rama y
   mete tipos fantasma en el typecheck): `✔ Generated Prisma Client (v7.8.0) ... in 636ms`.
2. `pnpm test` completo, sobre el arbol SIN tocar (commit `e657f666`):

```
 Test Files  1 failed | 777 passed (778)
      Tests  1 failed | 9431 passed (9432)
   Duration  250.16s
```

Sin «unhandled errors» de workers: la corrida NO esta degradada (778 archivos es el total con el
que se compara al cierre).

**El unico rojo es un flake ajeno por saturacion, comprobado en aislado:**

```
 FAIL tests/components/CuentasPorPagarTable.test.tsx
      > filtra la lista por nombre de mensajero sin tocar montos
      TestingLibraryElementError: Unable to find an element with the text: Ana Mensajera

$ pnpm vitest run tests/components/CuentasPorPagarTable.test.tsx
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Baseline que manda: 778 archivos / 9432 tests / 1 rojo (flake ajeno, verde en aislado).**

---

## T1 — Planificador puro del rango (R6-R10, R20)

- **Creado** `lib/analytics/backfill-rango.ts`: `HORIZONTE_HISTORIAL_CR = "2026-07-13"` con su
  procedencia (la migracion `20260713120000_orden_historial_estado`, aditiva y sin backfill),
  `esNoComparable` y `planificarBackfill({ desde, hasta, ahora })`.
  Solo importa `@/lib/utils/fecha-cr`; sin `process.env`, sin `console`, sin aritmetica de zona
  horaria propia (el «ayer CR» del mensaje de rechazo sale de `ultimosNDiasCalendarioCR`).
- **Creado** `tests/unit/analytics/backfill-rango.test.ts` (16 casos).
- Guardia de pureza (135/R1) reejecutado con el archivo nuevo dentro del censo: verde.

```
$ pnpm vitest run tests/unit/analytics/backfill-rango.test.ts tests/unit/analytics/modulo-puro.guardia.test.ts
 Test Files  2 passed (2)
      Tests  45 passed (45)
```
