# impl_45 — Wallet: gastos fijos/variables y sueldos

> Bitácora de implementación (Fase 2). Feature 45, rama `feature/45-wallet-gastos-sueldos`.
> Money-critical. F1.4 aprobada 2026-07-13 (c: sueldos texto libre; **b: gastos fijos por CRON**;
> resto recomendadas). Orquestada DIRECTO por el leader: backend_dev → frontend_dev → reviewer
> (para evitar el implementer monolítico y el bug opus-4.8[1m], precedente 56).

## Resultado
- **Reviewer APROBADO 0 bloqueantes** (`progress/review_45.md`).
- Verde REAL: `npx tsc --noEmit` 0, `eslint` 0, **`./init.sh` OK con 2545/2545 tests** (+~140 vs baseline 2405→2545), migraciones con `down.sql`.
- Trazabilidad R1–R33 → test completa (tabla al pie de `tasks.md`, verificada por el reviewer abriendo los tests, no por bitácora).

## Modelo / decisiones clave
- Egresos = filas `tipo=egreso` en el libro append-only **`wallet_movimiento`** (feature 42, polimórfico). SIN tabla de egresos nueva.
- **Enum** `wallet_movimiento_categoria` extendido con `egreso_gasto_fijo` + `egreso_gasto_variable` (`egreso_sueldo` ya existía). Migración aditiva `20260713140000_wallet_egreso_gasto_fijo_variable` (+ `down.sql` que recrea el tipo sin ellos, drop/recreate de los 2 índices que referencian `categoria`).
- **Gastos VARIABLES y SUELDOS = manual** (`WalletEgresoService.registrarEgreso`, `origen_id` NULL). Sueldo = nombre del trabajador + período como **texto libre** en la descripción (F1.4-c). El set manual permitido = {`gasto_variable`,`sueldo`}; `gasto_fijo` se RECHAZA por la vía manual (R19).
- **Gastos FIJOS = tabla nueva `gasto_fijo_plantilla`** (`concepto`, `monto` Decimal(12,2)>0, `activa`; RLS sin policies) que el maestro administra (crear/editar/activar/desactivar, SIN borrado). Migración `20260713150000_gasto_fijo_plantilla` (+ `down.sql` DROP TABLE).
- **CRON** `GET /api/cron/generar-gastos-fijos` (auth `CRON_SECRET` Bearer antes de efectos; schedule `0 6 1 * *` = día 1 00:00 CR en `vercel.json`; clon del patrón 41/46). Por cada plantilla ACTIVA genera un egreso `egreso_gasto_fijo`/`origen_tipo=gasto`/`origen_id="<plantillaId>:<YYYY-MM>"` en un único `createMany({skipDuplicates:true})`.
- **IDEMPOTENCIA por (plantilla, período)**: la clave `origen_id="<plantillaId>:<YYYY-MM>"` cae bajo el índice único parcial EXISTENTE `wallet_movimiento_origen_categoria_uq (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`. NO se creó ni alteró índice. No colisiona con la reversa (`ingreso_ajuste`, `origen_id`=uuid) ni con egresos manuales (`origen_id` NULL). Reejecutar el mismo mes → 0 filas nuevas, balance sin cambio (test de integración).
- **Reversa** compensatoria append-only (`ingreso_ajuste`, `origen_id`=egreso), idempotente (máx 1 reverso por egreso), aplica también a egresos del cron. Patrón de la 43.
- **Balance** = derivado de la 42 (el egreso resta), sin materializar saldo, sin doble conteo. UI añade desglose de egresos por tipo (gasto fijo / variable / sueldo).
- **Autorización**: solo `maestro` en egresos, plantillas, reversa y desglose.

## Superficies UI (rol maestro, `/wallet`)
- `RegistrarEgresoAdministrativoDialog` (manual {variable, sueldo}, sin gasto fijo), `GastosFijosPlantillasPanel` + `GastoFijoPlantillaDialog` (CRUD de plantillas, nota del cron), `DesgloseEgresosCard`, y "Reversar" por fila en `WalletLedger` (solo egresos administrativos). `WalletModule`/`page.tsx` integran + prefetch server-side.

## Cambios en código compartido (auditados por el reviewer, sin regresión 42/43/44)
- `lib/types/wallet.ts`: SEED de categorías extendido + **blindaje de `montoPositivoSchema`** con try/catch (monto vacío/no-numérico → `validation_error` en vez de INTERNAL/500; sin efecto para entradas válidas; robustece también el ajuste manual de la 42).
- `wallet-labels.ts` (2 labels + opciones de tipo), `WalletLedger.tsx` (columna Reversar), `WalletModule.tsx`, `wallet/page.tsx` (prefetch + notFound de defensa).

## Deuda menor (alineada al precedente 42–49)
- E2E del flujo de egresos escrito NO (diferido, convención del repo).
- Tests de migración/DB estáticos o en memoria (round-trip real verificado por backend_dev + reviewer contra el Postgres local).
- Al arrancar, el Postgres local tenía sin aplicar `20260712180000_pago_mensajero_movimiento` (44, ya en dev); se llevó al baseline con `migrate deploy` (migración commiteada, no reconciliación ajena).

## Pendiente
- PR a `dev` + merge (OK humano). Tras merge, el dev server local debe reiniciarse (schema nuevo → cliente Prisma; ver memoria).
