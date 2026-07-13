# Impl - Feature 43: Wallet POR TIENDA (saldo a favor de la tienda)

Rama feature/43-wallet-por-tienda. Baseline VERDE sobre origin/dev f25f4a8.
Coordinado por el implementer; backend_dev + frontend_dev (ambos model opus).
Money-critical. Reutiliza la feature 42 (NO redefine la formula). F1.4 APROBADA 2026-07-12.
Alcance = MODELO del saldo + VISIBILIDAD (Q4: pago/liquidacion queda como follow-up;
categorias pago_tienda/egreso_pago_tienda reservadas sin migracion adicional).

## Veredicto
Feature 43 completa y VERDE en modelo/migracion, feed/enganche del cierre, service/actions y frontend.

## Verificacion ejecutable (real)
- pnpm prisma validate -> schema valido.
- pnpm run typecheck (tsc --noEmit) -> 0 errores.
- pnpm run lint (eslint) -> 0 errores (135 warnings preexistentes en .claude/skills/* y minificados;
  los archivos nuevos de la 43 lintean limpio).
- pnpm test (vitest run) -> 232 test files passed / 2092 tests passed / 0 failed (~57s).
  Sin regresion de la cadena de cierres 37/38/39/40/56/41 ni de la wallet 42.
- Round-trip REAL de migracion contra Postgres local (localhost:5432): migrate deploy aplico,
  db:rollback revirtio limpio, re-aplico; migrate status = up to date.
- Grep money-safe: CERO parseFloat/Number( sobre montos en el codigo 43 (solo comentarios que lo
  documentan). Todos los DTOs de monto/saldo son STRING.

## Decisiones de implementacion (dentro del spec)
- Q3 interruptor TIENDA_DEBITA_FLETE_DEVOLUCION: unica fuente de verdad en lib/config/wallet-tienda.ts
  (DEFAULT true, override por env WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION). El WalletTiendaFeedService lo
  lee en un unico punto; para testear ambos estados sin manipular env, la config entra por constructor
  con default = singleton (no rompe "unica fuente de verdad").
- Credito COD cod_recaudado = gestion_orden.montoRecibido (Q2/R9); debitos = derivarIngresoOrden (42)
  mapeados 1:1 via lib/utils/mapeo-concepto-tienda.ts. La comision (debito) sigue basada en montoCobrar
  (decision de la 42, no alterada).
- Enganche en la MISMA $transaction de CierresAdminRepository.resolverCierre, tras alimentar la 42
  (atomico R7, idempotente por unique parcial (origen_tipo,origen_id,tienda_id,categoria) R6).
- Vista maestro (R20) en /wallet/tiendas (design 2.3 / A1).

## Archivos creados
Backend:
- db/migrations/20260712170000_wallet_tienda_movimiento/migration.sql + down.sql
- lib/types/wallet-tienda.ts
- lib/utils/saldo-tienda.ts
- lib/utils/mapeo-concepto-tienda.ts
- lib/config/wallet-tienda.ts
- lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts
- lib/interfaces/services/IWalletTiendaFeedService.ts
- lib/interfaces/services/IWalletTiendaService.ts
- lib/repositories/WalletTiendaMovimientoRepository.ts
- lib/services/WalletTiendaFeedService.ts
- lib/services/WalletTiendaService.ts
- lib/actions/wallet-tienda.ts

Frontend:
- app/(app)/mi-wallet/page.tsx
- app/(app)/mi-wallet/_components/MiWalletModule.tsx
- app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx
- app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx
- app/(app)/mi-wallet/_components/MiWalletFiltros.tsx
- app/(app)/mi-wallet/_components/mi-wallet-labels.ts
- app/(app)/wallet/tiendas/page.tsx
- app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx

Tests:
- tests/integration/db/wallet-tienda-migration.test.ts
- tests/integration/db/wallet-tienda-idempotencia.test.ts
- tests/integration/mi-wallet-page.test.tsx
- tests/unit/utils/saldo-tienda.test.ts
- tests/unit/config/wallet-tienda-config.test.ts
- tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts
- tests/unit/services/wallet-tienda-feed-service.test.ts
- tests/unit/services/wallet-tienda-service.test.ts
- tests/unit/actions/wallet-tienda-actions.test.ts
- e2e/mi-wallet.spec.ts

## Archivos modificados
- db/schema.prisma - enums WalletTiendaMovimientoTipo/Categoria, modelo WalletTiendaMovimiento,
  2 lados inversos en Usuario (reutiliza WalletOrigenTipo).
- lib/repositories/CierresAdminRepository.ts - 2 deps nuevas + alimentacion del ledger por tienda en
  la misma $transaction, tras la 42.
- lib/actions/cierres-admin.ts - wiring buildService().
- tests/unit/repositories/cierres-admin-repository.test.ts, tests/unit/services/cierres-admin-service.test.ts,
  tests/unit/services/cierres-bodega-admin-service.test.ts, tests/integration/db/wallet-idempotencia.test.ts,
  tests/integration/db/zonas-migration.test.ts - dobles/casos del enganche extendido (42 intacta).
- specs/43-wallet-por-tienda/tasks.md - T1..T18 marcadas.

## Mapa R1..R29 -> test
- R1  wallet-tienda-migration.test.ts (fila inmutable, sin updated/deleted)
- R2  wallet-tienda-movimiento-repository.test.ts (persiste tienda_id/tipo/categoria/monto/origen/fecha)
- R3  wallet-tienda-service.test.ts (sin update/delete; correccion = ajuste)
- R4  saldo-tienda.test.ts (Decimal exacto, STRING 2 dec)
- R5  cierres-admin-service.test.ts + cierres-admin-repository.test.ts (aprobar CierreDia genera movimientos por tienda)
- R6  wallet-tienda-idempotencia.test.ts + wallet-tienda-migration.test.ts (unique parcial 4-col)
- R7  cierres-admin-repository.test.ts (fallo insert 43 -> rollback de todo, misma tx que 42)
- R8  saldo-tienda.test.ts (mapeo 1:1) + wallet-tienda-feed-service.test.ts (debitos = derivarIngresoOrden)
- R9  wallet-tienda-feed-service.test.ts (cod_recaudado=montoRecibido; null->0.00)
- R10 wallet-tienda-feed-service.test.ts (flag=true genera devolucion sin credito; flag=false no la emite; reprogramada nada)
- R11 wallet-tienda-feed-service.test.ts (1 mov por tienda/cierre/concepto; omite 0.00)
- R12 cierres-bodega-admin-service.test.ts (CierreBodega NO alimenta tienda)
- R13 cierres-admin-service.test.ts (vencido->aprobado alimenta una vez)
- R14 wallet-tienda-feed-service.test.ts (zona sin tarifa -> debitos 0.00, credito intacto)
- R15 wallet-tienda-feed-service.test.ts (invariante en AMBOS estados del flag: cuadre vs COD + Sum debitos_X = ingreso_X 42; flag=false -> diferencia = flete_dev+IVA, Sum_tiendas=0.00, 42 intacta)
- R16 saldo-tienda.test.ts (saldo = Sum credito - Sum debito, sin saldo almacenado)
- R17 saldo-tienda.test.ts (negativo/positivo/cero, STRING 2 dec + signo)
- R18 mi-wallet-page.test.tsx (adminTienda ve su saldo + desglose)
- R19 wallet-tienda-service.test.ts + mi-wallet-page.test.tsx (acotado a tienda_id en WHERE; otra tienda/rol -> notFound/forbidden)
- R20 wallet-tienda-service.test.ts (maestro ve saldos de todas las tiendas)
- R21 mi-wallet-page.test.tsx (datos via Server Component -> props STRING, sin Decimal al cliente)
- R22 wallet-tienda-service.test.ts (filtros fecha/cierre/concepto en el WHERE)
- R23 wallet-tienda-migration.test.ts (pago_tienda + egreso_pago_tienda reservados sin migracion adicional)
- R24 wallet-tienda-migration.test.ts (RLS habilitada sin policies anon/authenticated)
- R25 wallet-tienda-migration.test.ts (round-trip up/down reversible)
- R26 wallet-tienda-migration.test.ts (3 indices + unique parcial de idempotencia)
- R27 transversal: asserts STRING en DTOs + wallet-tienda-actions.test.ts + grep money-safe limpio
- R28 wallet-tienda-feed-service.test.ts + wallet-tienda-config.test.ts (default true; flag=false no emite los 2 debitos de devolucion; leido de un unico punto)
- R29 wallet-tienda-feed-service.test.ts (reversion historica por ajuste compensatorio sin UPDATE/DELETE; alternar flag sin migracion)

## E2E
- e2e/mi-wallet.spec.ts - acceso del adminTienda a su saldo + desglose; bloqueo de rol no autorizado
  (no ve saldo ni desglose). Escrito con precondiciones seed documentadas; no se ejecuta bajo pnpm test
  (misma convencion diferida que el resto de e2e del repo, incluido e2e/wallet.spec.ts de la 42).

## Riesgos / deuda
- E2E escrito pero no ejecutado (sin entorno seed), igual que la 42.
- Pago/liquidacion a la tienda: follow-up (Q4). Enums/categorias reservados y verificados usables sin
  migracion adicional.
- feature_list.json y progress/current.md (dominio del leader) NO tocados por el implementer.
