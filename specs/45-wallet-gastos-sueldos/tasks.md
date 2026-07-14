# Feature 45 — Wallet: gastos fijos/variables y sueldos — tasks.md

> Checklist discreto y verificable. `[P]` = paralelizable (sin dependencia mutua ni de
> archivo). Backend primero (BE), luego frontend (FE). Money-critical: nada "hecho" sin
> test verde. Mapa `R<n> → test` en la tabla final (regla del reviewer, `docs/verification.md`).
>
> **Cambio F1.4:** gasto fijo = plantilla + cron mensual; gasto variable/sueldo = manual.
>
> **✅ ESTADO 2026-07-13: TODAS las tareas T1–T24 COMPLETAS y verificadas.** Backend + frontend en verde; `init.sh` OK, **2545/2545 tests**, typecheck 0, lint 0; reviewer **APROBADO 0 bloqueantes** (`progress/review_45.md`). Trazabilidad R1–R33 → test confirmada (tabla al pie).

## Dependencias (orden)

```
T1 (migración enum) ─┬─> T2 (types/seed + zod) ─┬─> T3 (repo movimiento) ─> T4 (WalletEgresoService) ─> T5 (actions egresos)
                     │                          ├─> [P] T14 labels (FE, compila con T2)
                     │                          └─> T15 (types plantilla + zod)
                     └─> T6 (test migración enum round-trip)

T16 (migración tabla plantilla) ─┬─> T17 (repo plantilla) ─> T18 (GastoFijoPlantillaService) ─> T19 (actions plantilla)
                                 │                        └─> T20 (util periodoMensualCR) ─> T21 (GeneracionGastosFijosService) ─> T22 (cron route + vercel.json)
                                 └─> T23 (test migración tabla round-trip)

T5  ─> T9 (dialog egreso FE) ─> T10 (módulo/página FE) ─> T11 (ledger reversa FE)
T19 ─> T24 (panel plantillas FE) ─> T10
T4/T5           ─> T7  (tests BE: WalletEgreso unit + integration + action)
T18/T21/T22     ─> T8  (tests BE: plantilla CRUD + cron auth/idempotencia/hora CR)
T9/T10/T11/T24  ─> T12 (tests FE component)
todo            ─> T13 (no-regresión + init.sh)
```

## Backend — egresos (manual + reversa)

### [x] T1 — Migración aditiva de enum + down.sql (BE)
- Crear `db/migrations/<ts>_wallet_egreso_gasto_fijo_variable/migration.sql`:
  `ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_fijo';` y `'egreso_gasto_variable';`.
- Actualizar `db/schema.prisma` (enum `WalletMovimientoCategoria`): añadir ambos valores.
- Escribir `down.sql` que recrea el tipo sin los 2 valores (drop/recreate índices
  `wallet_movimiento_tipo_categoria_idx` y `wallet_movimiento_origen_categoria_uq`), precondición sin filas nuevas (design §5.1).
- **Hecho cuando:** `prisma validate` OK; `prisma migrate deploy` aplica; `prisma migrate status` up-to-date. (R21)

### [x] T2 — Tipos/seed + zod de egresos (BE) [dep: T1]
- `lib/types/wallet.ts`: añadir `egreso_gasto_fijo`/`egreso_gasto_variable` a `WALLET_MOVIMIENTO_CATEGORIA_SEED`
  (guardas `satisfies`/`_EnsureCategoriaExhaustive` deben compilar). Añadir `registrarEgresoAdministrativoSchema`
  (`tipoEgreso: ["gasto_variable","sueldo"]`), `reversarEgresoSchema`, tipos `RegistrarEgresoAdministrativoInput`,
  `DesgloseEgresosDTO` (montos STRING).
- **Hecho cuando:** `pnpm typecheck` 0 errores. (R2/R4/R5/R12/R19)

### [x] T3 — Repository movimiento: obtenerPorId + agregarPorCategoria (BE) [dep: T2]
- Extender `IWalletMovimientoRepository` + `WalletMovimientoRepository` con `obtenerPorId(id)` (reversa, R13) y
  `agregarPorCategoria(filtros)` (desglose, R11); reutilizar `buildWhere`. NO tocar `crearMovimientos`/`agregarBalance`/`listar`.
- **Hecho cuando:** typecheck 0 + tests T7 (repo) verdes. (R11/R13)

### [x] T4 — Service `WalletEgresoService` (BE) [dep: T3]
- `lib/interfaces/services/IWalletEgresoService.ts` + `lib/services/WalletEgresoService.ts`: `registrarEgreso`,
  `reversarEgreso`, `verDesgloseEgresos`. Guardia `maestro`. Mapeo `tipoEgreso ∈ {gasto_variable,sueldo}` → categoría.
  Reversa lee monto server-side, usa `origen_id`=egreso; aplica también a egresos del cron. `WalletService` intacto.
- **Hecho cuando:** tests unit T7 verdes. (R1/R2/R3/R7/R13/R15/R16/R17/R32)

### [x] T5 — Server Actions de egresos (BE) [dep: T4]
- `lib/actions/wallet-egresos.ts`: `registrarEgresoAdministrativoAction`, `reversarEgresoAdministrativoAction`,
  `verDesgloseEgresosAction` (patrón `lib/actions/wallet.ts`, `withErrorHandler`, `resolveActorFromSession`,
  `unauthenticated`/`validation_error` en el borde).
- **Hecho cuando:** tests de action T7 verdes. (R4/R5/R17/R18/R19)

## Backend — plantillas de gasto fijo + cron

### [x] T16 — Migración aditiva tabla `gasto_fijo_plantilla` + down.sql (BE)
- Crear `db/migrations/<ts>_gasto_fijo_plantilla/migration.sql`: `CREATE TABLE gasto_fijo_plantilla` (id, concepto,
  monto Decimal(12,2), activa bool default true, created_at, updated_at) + `CREATE INDEX ..._activa_idx` +
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (sin policies, patrón wallet_tienda_movimiento, design §5.2).
- Añadir el modelo `GastoFijoPlantilla` a `db/schema.prisma`. Escribir `down.sql`: `DROP TABLE IF EXISTS "gasto_fijo_plantilla";`.
- **Hecho cuando:** `prisma validate` OK; migrate deploy aplica; migrate status up-to-date; RLS activa sin policies. (R20/R33)

### [x] T15 — Tipos + zod de plantilla (BE) [dep: T2]
- `lib/types/gasto-fijo-plantilla.ts`: `crearGastoFijoPlantillaSchema` (concepto min 1, monto positivo STRING),
  `actualizarGastoFijoPlantillaSchema` (+id uuid), `setActivaPlantillaSchema` (id uuid, activa bool),
  `GastoFijoPlantillaDTO` (montos STRING).
- **Hecho cuando:** `pnpm typecheck` 0 errores. (R12/R24/R25)

### [x] T17 — Repository `GastoFijoPlantillaRepository` (BE) [dep: T15/T16]
- `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts` + `lib/repositories/GastoFijoPlantillaRepository.ts`:
  `crear`, `actualizar`, `setActiva`, `listar`, `listarActivas`, `obtenerPorId`. Montos STRING en el DTO. SIN `delete` (R25).
- **Hecho cuando:** typecheck 0 + tests T8 (repo) verdes. (R24/R25/R26)

### [x] T18 — Service `GastoFijoPlantillaService` (BE) [dep: T17]
- `lib/interfaces/services/IGastoFijoPlantillaService.ts` + `lib/services/GastoFijoPlantillaService.ts`:
  `crearPlantilla`, `actualizarPlantilla`, `activarPlantilla`/`desactivarPlantilla`, `listarPlantillas`. Guardia `maestro`.
- **Hecho cuando:** tests unit T8 verdes. (R17/R24/R25/R26)

### [x] T19 — Server Actions de plantilla (BE) [dep: T18]
- `lib/actions/gasto-fijo-plantilla.ts`: `crearPlantillaAction`, `actualizarPlantillaAction`, `setActivaPlantillaAction`,
  `listarPlantillasAction` (patrón `lib/actions/wallet.ts`; `unauthenticated`/`validation_error` en el borde).
- **Hecho cuando:** tests de action T8 verdes. (R17/R18/R24)

### [x] T20 — Util `periodoMensualCR` (BE) [dep: T16]
- Extender `lib/utils/fecha-cr.ts` con `periodoMensualCR(now): string` → `YYYY-MM` en hora CR (reutiliza `CR_OFFSET_MS`).
- **Hecho cuando:** tests de fronteras (00:00 CR del 1 / 23:59 CR del último día) verdes (T8). (R30)

### [x] T21 — Service `GeneracionGastosFijosService` (cron logic) (BE) [dep: T17/T20]
- `lib/interfaces/services/IGeneracionGastosFijosService.ts` + `lib/services/GeneracionGastosFijosService.ts`:
  `ejecutarGeneracion(now)`. Lee `listarActivas`; construye un egreso por plantilla (categoria=egreso_gasto_fijo,
  origen_tipo=gasto, origen_id=`${p.id}:${periodo}`, monto=p.monto, descripcion=`${p.concepto} — ${periodo}`,
  registradoPor=null); `crearMovimientos` en un ÚNICO createMany (atómico + skipDuplicates). Devuelve conteos.
- **Hecho cuando:** tests unit T8 verdes (genera por activas, no por inactivas, idempotente). (R27/R28/R31)

### [x] T22 — Route Handler del cron + vercel.json (BE) [dep: T21]
- `app/api/cron/generar-gastos-fijos/route.ts` (clon 41/46): `GET` → `handleGenerarGastosFijos(req, deps)`;
  auth `CRON_SECRET` (Bearer) ANTES de efectos (401 sin construir service); `now` inyectable; delega en el service;
  responde conteos (sin PII); nunca loguea el secreto.
- `vercel.json`: añadir `{ "path": "/api/cron/generar-gastos-fijos", "schedule": "0 6 1 * *" }` (día 1, 00:00 CR).
- **Hecho cuando:** tests del handler T8 verdes (401 sin/incorrecto secreto sin tocar DB; 200 con conteos). (R29/R30)

## Frontend

### [x] T14 — Etiquetas de categoría (FE) [P] [dep: T2]
- `app/(app)/wallet/_components/wallet-labels.ts`: añadir `egreso_gasto_fijo`/`egreso_gasto_variable` a
  `CATEGORIA_LABEL` ("Gasto fijo"/"Gasto variable") — el `Record` exhaustivo rompe el build si faltan.
- **Hecho cuando:** typecheck 0; filtro por categoría muestra las nuevas opciones. (R10)

### [x] T9 — Dialog de egreso manual (FE) [dep: T5]
- `app/(app)/wallet/_components/RegistrarEgresoAdministrativoDialog.tsx`: form (Select tipo **{Gasto variable,
  Sueldo}**, monto STRING regex >0, descripción obligatoria con label adaptado), llama
  `registrarEgresoAdministrativoAction`, toast + `onRegistrado`. NO ofrece "gasto fijo".
- **Hecho cuando:** tests component T12 verdes. (R22a/R4/R5/R19)

### [x] T24 — Panel CRUD de plantillas de gasto fijo (FE) [dep: T19]
- `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`: lista (concepto, monto `money()`, estado activa),
  toggle activar/desactivar (`setActivaPlantillaAction`), crear/editar (dialog reutilizado con
  `crear/actualizarPlantillaAction`), nota "los egresos los genera el cron". `recargar`+`router.refresh()`.
- **Hecho cuando:** tests component T12 verdes. (R22b/R23/R24/R25/R26)

### [x] T10 — Desglose + integración en módulo/página (FE) [dep: T9/T24]
- `DesgloseEgresosCard.tsx` (totales por tipo, STRING). `WalletModule.tsx` monta dialog + tarjeta + panel de
  plantillas; `page.tsx` pre-fetch de `verDesgloseEgresosAction` y `listarPlantillasAction` por props.
- **Hecho cuando:** tests component T12 verdes; desglose y plantillas reflejan el estado. (R11/R23)

### [x] T11 — Acción de reversa por fila en el libro (FE) [dep: T10]
- `WalletLedger.tsx`: acción "Reversar" (con `Modal` de confirmación) SOLO en egresos administrativos
  (`origen_tipo==="gasto"` ∧ `tipo==="egreso"`, incluye los del cron), llama `reversarEgresoAdministrativoAction`, refresca.
- **Hecho cuando:** tests component T12 verdes. (R13/R14/R22c/R32)

## Tests

### [x] T7 — Tests backend egresos (unit + integration + action) [dep: T4/T5]
- Unit service (`tests/unit/services/wallet-egreso-service.test.ts`): creación de gasto variable y sueldo (mapeo
  categoría, origen_tipo=gasto, origen_id=null, registrado_por); forbidden no-maestro; reversa crea `ingreso_ajuste`
  de igual monto referenciando el original; reversa de un egreso generado por el cron; reversa forbidden no-maestro; desglose.
- Integration DB (`tests/integration/db/wallet-egreso.test.ts`): insertar egreso resta del balance derivado; reversa
  net cero; **doble reversa = una sola fila** (índice parcial); no dedup de egresos manuales con origen_id NULL.
- Action (`tests/unit/actions/wallet-egresos-actions.test.ts`): `validation_error` (monto ≤0/vacío, descripción vacía,
  tipoEgreso inválido incl. "gasto_fijo" rechazado), `unauthenticated`, `forbidden`.
- **Hecho cuando:** todos verdes.

### [x] T8 — Tests backend plantillas + cron [dep: T18/T21/T22]
- Unit plantilla service (`tests/unit/services/gasto-fijo-plantilla-service.test.ts`): crear/editar/activar/desactivar/
  listar; forbidden no-maestro; SIN método de borrado.
- Unit util (`tests/unit/utils/fecha-cr-periodo.test.ts`): `periodoMensualCR` en fronteras CR (00:00 CR del 1 → mes actual;
  23:59 CR del último día del mes anterior → mes anterior). (R30)
- Unit cron service (`tests/unit/services/generacion-gastos-fijos-service.test.ts`): genera un egreso por plantilla
  ACTIVA; NO genera por inactivas; origen_id=`<plantillaId>:<periodo>`, categoria=egreso_gasto_fijo, registradoPor=null.
- Integration DB (`tests/integration/db/generacion-gastos-fijos.test.ts`): correr el cron dos veces el MISMO periodo →
  segunda corrida inserta 0 filas y el balance NO cambia (idempotencia por período, R28/R31); dos periodos distintos →
  dos egresos por plantilla.
- Handler cron (`tests/unit/api/generar-gastos-fijos-route.test.ts`): 401 sin secreto / secreto incorrecto / secreto no
  configurado, SIN construir service ni tocar DB; 200 con conteos cuando el secreto es válido; no loguea el secreto. (R29)
- **Hecho cuando:** todos verdes.

### [x] T6 — Test round-trip de migración enum (BE) [dep: T1]
- `tests/integration/db/wallet-egreso-migration.test.ts`: aplica (los valores existen), revierte con `down.sql` (tipo
  recreado sin ellos), reaplica → `migrate status` up-to-date. (R21)
- **Hecho cuando:** round-trip verde.

### [x] T23 — Test round-trip de migración tabla plantilla (BE) [dep: T16]
- `tests/integration/db/gasto-fijo-plantilla-migration.test.ts`: aplica (tabla + índice + RLS existen), revierte con
  `down.sql` (tabla eliminada), reaplica → `migrate status` up-to-date; verifica RLS habilitada sin policies. (R20/R33)
- **Hecho cuando:** round-trip verde.

### [x] T12 — Tests component (FE) [dep: T9/T10/T11/T24]
- Dialog egreso: render, selector de tipo {variable, sueldo} (sin "gasto fijo"), submit llama la action, errores de validación.
- Panel plantillas: render lista, crear/editar/activar/desactivar llaman sus actions; muestra monto STRING.
- Ledger: fila de egreso administrativo (manual y del cron) muestra "Reversar"; ingreso/pago no la muestran.
- Desglose: renderiza los 3 totales como STRING. (R10/R11/R13/R22/R24/R25/R26)
- **Hecho cuando:** verdes.

### [x] T13 — No-regresión + verificación integral [dep: todo]
- Suite existente verde (`wallet-service`, `wallet-movimiento-repository`, `wallet-idempotencia`, `cierres-admin`,
  `wallet-tienda`, `pago-mensajero`, crons `corte-diario`/`liberar-reprogramadas`): el balance de 42/43/44 no cambia (R8/R9/R20).
- `./init.sh` (typecheck 0, lint 0, tests, estado del arnés) verde.
- **Hecho cuando:** `./init.sh` verde y balance 42/43/44 sin cambios.

## Mapa de trazabilidad `R<n> → test`

| Req | Test (tarea) |
| --- | --- |
| R1 registra egreso `tipo=egreso` | unit service creación (T7) + integration insert (T7) + cron genera egreso (T8) |
| R2 mapeo manual variable/sueldo→categoria | unit service creación de cada tipo (T7) |
| R3 manual: origen_tipo=gasto/origen_id=null/registrado_por | unit service asserts de fila (T7) |
| R4 monto>0 STRING (manual) | action `validation_error` monto (T7) + dialog validación (T12) |
| R5 descripción obligatoria (manual) | action `validation_error` descripción (T7) + dialog (T12) |
| R6 inmutabilidad (sin update/delete) | service no expone mutación (T7) — assert de API |
| R7 atomicidad insert manual | integration insert único (T7) |
| R8 egreso resta balance | integration balance derivado (T7) |
| R9 sin regresión 42/43/44 | suite existente verde (T13) |
| R10 libro filtrable por categoría | filtro categoría muestra nuevas (T14) + ledger (T12) |
| R11 desglose por tipo | unit desglose (T7) + component desglose (T12) |
| R12 montos STRING en frontera | action devuelve STRING (T7/T8) + DTO types (T2/T15) |
| R13 reversa = ingreso_ajuste igual monto, ref original | unit reversa (T7) + ledger (T11/T12) |
| R14 original intacto al reversar | integration append-only (T7) |
| R15 no doble compensación (idempotente) | integration doble reversa = 1 fila (T7) |
| R16 reversa net cero | integration balance net cero (T7) |
| R17 solo maestro (egreso+reversa+CRUD) | unit forbidden egreso (T7) + plantilla (T8) |
| R18 unauthenticated | action egreso (T7) + action plantilla (T8) |
| R19 rechaza tipo manual fuera del set (incl. gasto_fijo) | action `validation_error` tipoEgreso (T7) + dialog (T12) |
| R20 RLS wallet_movimiento intacta + tabla nueva RLS sin policies | migración enum no toca RLS (T6) + tabla plantilla RLS (T23) + no-regresión (T13) |
| R21 migración aditiva enum + down round-trip | migración enum round-trip (T6) |
| R22 form manual {variable,sueldo} + CRUD plantillas + reversa UI | dialog (T12) + panel plantillas (T12) + ledger reversa (T12) |
| R23 refresco de vista tras registrar/reversar/editar plantilla | component módulo recarga (T12) |
| R24 crear plantilla (concepto/monto válidos) | unit plantilla service (T8) + action validación (T8) + panel (T12) |
| R25 editar + activar/desactivar, sin borrado | unit plantilla service (T8) — assert sin delete + panel toggle (T12) |
| R26 listar plantillas (activas/inactivas) | unit plantilla service listar (T8) + panel render (T12) |
| R27 cron genera 1 egreso por plantilla activa; inactivas no | unit cron service (T8) + integration (T8) |
| R28 idempotencia por (plantilla, periodo) | integration doble corrida mismo mes = 0 filas / balance sin cambio (T8) |
| R29 auth CRON_SECRET antes de efectos, sin loguear secreto | handler cron 401 sin/incorrecto/no-config (T8) |
| R30 periodo YYYY-MM en hora CR | util `periodoMensualCR` fronteras (T8) |
| R31 atomicidad cron + no doble conteo | integration cron atómico + reejecución sin cambio de balance (T8) |
| R32 reversa aplica a egreso del cron + desactivar plantilla | unit reversa de egreso cron (T7) + panel desactivar (T12) |
| R33 migración aditiva tabla plantilla + down round-trip | migración tabla round-trip (T23) |
