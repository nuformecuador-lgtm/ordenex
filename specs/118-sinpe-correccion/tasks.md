# Feature 118 — Corrección SIMPE → SINPE (tasks)

> `[P]` = paralelizable con otras `[P]` del mismo bloque (no comparten archivo).
> Cada task cierra con su criterio de "hecho". Requisitos en `requirements.md`.

## Bloque A — enum Postgres + Prisma (categoría a) · debe ir PRIMERO
Regenera el cliente Prisma y por exhaustividad fuerza el resto de cambios TS.

- [ ] **T1** — Editar `db/schema.prisma`: en `enum MetodoPagoValue` cambiar `SIMPE`
  → `SINPE` (línea 418) y actualizar el comentario de la 415.
  *Hecho:* el enum Prisma lista `efectivo/SINPE/transferencia`.
- [ ] **T2** (depende de T1) — Crear migración nueva
  `db/migrations/<ts>_metodo_pago_rename_simpe_to_sinpe/migration.sql` con
  `ALTER TYPE "metodo_pago_value" RENAME VALUE 'SIMPE' TO 'SINPE';` (R2).
  *Hecho:* archivo existe con la sentencia exacta y comentario que explica que
  preserva filas (R4).
- [ ] **T3** (depende de T2) — Crear `down.sql` inverso:
  `ALTER TYPE "metodo_pago_value" RENAME VALUE 'SINPE' TO 'SIMPE';` (R3).
  *Hecho:* `down.sql` existe y es el inverso exacto.
- [ ] **T4** (depende de T2) — Aplicar en local (`pnpm run db:migrate`) y regenerar
  cliente Prisma. *Hecho:* introspección muestra enum = {efectivo, SINPE,
  transferencia}; `pnpm run db:rollback` (aplica `down.sql`) revierte a `SIMPE` y
  re-migra limpio (R3/R4 verificados a mano).

## Bloque B — tipos TS (categoría b) · depende de T1/T4
- [ ] **T5** — `lib/types/metodo-pago.ts`: `METODO_PAGO_SEED` `SIMPE`→`SINPE` (línea 13)
  y comentario (línea 5). *Hecho:* `satisfies readonly MetodoPagoValue[]` y
  `_EnsureExhaustive` compilan verdes.
- [ ] **T6** [P] — `lib/utils/cierre-totales.ts`: `case "SIMPE":` → `case "SINPE":`
  (línea 64). NO tocar la variable/clave `simpe` (R9). *Hecho:* `computeTotales`
  ramifica por `SINPE`; build verde.

## Bloque C — seeds (categoría c)
- [ ] **T7** — Confirmar que no existe seed SQL/TS con el valor del enum (censo:
  `scripts/seed-*.ts` sin `metodo_pago`). *Hecho:* nota en el PR de que (c) queda
  cubierto por `METODO_PAGO_SEED` (T5); sin archivo adicional.

## Bloque D — texto user-facing (categoría d) · depende de T5 · todas [P] entre sí
- [ ] **T8** [P] — `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts:10`:
  clave `SIMPE`→`SINPE` y label `"SIMPE"`→`"SINPE"`.
- [ ] **T9** [P] — `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`: `METODO_LABEL`
  clave+label (123), `label="SINPE"` (321), `value:"SINPE"` en columna (671; `id:"simpe"`
  interno NO cambia).
- [ ] **T10** [P] — `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`:
  `METODO_LABEL` (46), `label="SINPE"` (259), comentario (229).
- [ ] **T11** [P] — `app/(app)/cierres-admin/_components/CierresAdminModule.tsx:337`:
  `label="SINPE"`.
- [ ] **T12** [P] — `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx:243`:
  `value:"SINPE"` (`id:"simpe"` interno NO cambia).
  *Hecho (T8–T12):* la UI muestra `"SINPE"`; ningún label renderiza `"SIMPE"` (R6/R8).

## Bloque E — tests (categoría e) · depende de Bloques A–D
- [ ] **T13** [P] — `tests/unit/types/metodo-pago.test.ts:10-11`: nombre + set a `SINPE`.
- [ ] **T14** [P] — `tests/unit/utils/cierre-totales.test.ts:47`: `metodoPago:"SINPE"`
  (dejar `simpe:` DTO intacto).
- [ ] **T15** [P] — `tests/unit/types/gestion-orden-schemas.test.ts:117`: `"SINPE"`.
- [ ] **T16** [P] — `tests/unit/services/cierre-dia-service.test.ts`: `metodoPago:"SINPE"`
  y aserciones (197,213,259,419,480,489); claves `simpe:` DTO intactas.
- [ ] **T17** [P] — `tests/unit/services/cierres-admin-service.test.ts:397`: `"SINPE"`.
- [ ] **T18** [P] — `tests/unit/services/cierre-bodega-service.test.ts:363`: texto del
  nombre del test → `SINPE`.
- [ ] **T19** [P] — `tests/integration/db/resolver-novedad-reprograma-dinero.test.ts:95,140`:
  textos → `SINPE`.
- [ ] **T20** [P] — `tests/integration/actions/cierre-dia-action.test.ts:252`: `"SINPE"`.
- [ ] **T21** [P] — `tests/components/CierreDiaModule.test.tsx:186,193`: `metodoPago:"SINPE"`
  + `getByText("SINPE")`.
- [ ] **T22** [P] — `tests/components/CierresAdminModule.test.tsx:471,492`: igual.
- [ ] **T23** — `tests/integration/db/gestion-orden-migration.test.ts:48,53`:
  **desacoplar** de `METODO_PAGO_SEED`; afirmar el literal HISTÓRICO `SIMPE` (R10)
  con set `{efectivo, SIMPE, transferencia}`. *Hecho:* el test verifica que la
  migración histórica sigue creando `SIMPE` y NO depende del seed vigente.
- [ ] **T24** — Crear test NUEVO de la migración rename
  `tests/integration/db/metodo-pago-rename-simpe-sinpe-migration.test.ts`: UP afirma
  `RENAME VALUE 'SIMPE' TO 'SINPE'`, DOWN afirma inverso (R2/R3) y, si hay DB de test,
  fila `SIMPE`→`SINPE` con conteo estable (R4). *Hecho:* R2/R3/R4 trazados a este test.
- [ ] **T25** [P] — `e2e/cierre-dia.spec.ts:11`: comentario → `SINPE`.
- [ ] **T26** (opcional, R12) — Guard de censo: test que corre un grep case-sensitive
  de `SIMPE` sobre `app/`, `lib/`, `tests/`, `e2e/` y falla si hay coincidencias fuera
  de la migración histórica y el `down.sql`. *Hecho:* el guard pasa en verde.

## Bloque F — cierre
- [ ] **T27** (depende de todo) — `./init.sh` verde + suite completa verde
  (`docs/verification.md`). Regenerar cliente Prisma si el type-check da falso
  negativo (memoria del repo). Mapear cada R→test en `progress/impl_118-sinpe-correccion.md`.
  *Hecho:* init + tests verdes; mapa de trazabilidad R1–R12 completo.

---

## Archivos esperados (para validación de conflictos de paralelismo)

**Se MODIFICAN (fuentes, 8):**
```
db/schema.prisma
lib/types/metodo-pago.ts
lib/utils/cierre-totales.ts
app/(app)/mis-asignaciones/_components/metodo-pago-options.ts
app/(app)/cierre-dia/_components/CierreDiaModule.tsx
app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx
app/(app)/cierres-admin/_components/CierresAdminModule.tsx
app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx
```

**Se MODIFICAN (tests, 12):**
```
tests/unit/types/metodo-pago.test.ts
tests/unit/utils/cierre-totales.test.ts
tests/unit/types/gestion-orden-schemas.test.ts
tests/unit/services/cierre-dia-service.test.ts
tests/unit/services/cierres-admin-service.test.ts
tests/unit/services/cierre-bodega-service.test.ts
tests/integration/db/resolver-novedad-reprograma-dinero.test.ts
tests/integration/db/gestion-orden-migration.test.ts
tests/integration/actions/cierre-dia-action.test.ts
tests/components/CierreDiaModule.test.tsx
tests/components/CierresAdminModule.test.tsx
e2e/cierre-dia.spec.ts
```

**Se CREAN (migración + test, 3; +1 guard opcional):**
```
db/migrations/<ts>_metodo_pago_rename_simpe_to_sinpe/migration.sql
db/migrations/<ts>_metodo_pago_rename_simpe_to_sinpe/down.sql
tests/integration/db/metodo-pago-rename-simpe-sinpe-migration.test.ts
tests/unit/guards/censo-simpe.test.ts            # opcional (R12)
```

**NO se tocan (categoría f, R9/R10) — lista de exclusión para el reviewer:**
```
# columna/campo snapshot de dinero (mantienen total_simpe / totalSimpe / clave DTO simpe)
db/schema.prisma  (líneas 535, 577 — total_simpe)   # sólo cambia el enum, NO estas líneas
db/migrations/20260711150000_gestion_orden_estados_metodo_pago/**   # histórica, inmutable
db/migrations/20260712120000_cierre_bodega/**
db/migrations/20260712100000_cierre_dia/**
lib/repositories/CierreBodegaRepository.ts
lib/repositories/CierreDiaRepository.ts
lib/repositories/CierresAdminRepository.ts
lib/repositories/CierresBodegaAdminRepository.ts
lib/services/CierreBodegaService.ts
lib/interfaces/repositories/ICierresAdminRepository.ts
lib/interfaces/services/ICierreDiaService.ts
tests/unit/repositories/**  y demás aserciones { efectivo, simpe, transferencia, general }
feature_list.json, progress/**, specs/** (registro histórico)
```

> Total real a tocar: **~23 archivos** (8 fuentes + 12 tests + 3 nuevos). NO ~59: la
> diferencia son los ~35 archivos de la categoría (f) que por regla explícita se
> conservan (`total_simpe` y la clave DTO interna `simpe`).
