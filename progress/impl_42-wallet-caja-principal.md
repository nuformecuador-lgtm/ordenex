# Impl - Feature 42: wallet, caja principal de Ordenex

Rama feature/42-wallet-caja-principal. Baseline VERDE sobre origin/dev 84ddc3b.
Coordinado por el implementer; backend_dev + frontend_dev (ambos model opus).
F1.4 APROBADA 2026-07-12. Money-critical: Prisma.Decimal en todo calculo, STRING
toFixed(2) en la frontera, cero parseFloat/Number sobre montos.

## Veredicto

Feature 42 implementada end-to-end (backend T1-T10 + frontend T11-T13) y VERDE en
verificacion ejecutable. Unica verificacion DIFERIDA: el round-trip
db:migrate/db:rollback REAL contra Postgres (ver Riesgos / deuda). El reviewer decide.

## Verificacion ejecutable (salida real)

- prisma validate -> The schema at db/schema.prisma is valid.
- typecheck (tsc --noEmit, strict) -> 0 errores.
- lint (eslint) -> 0 errores (135 warnings, TODOS preexistentes en .claude/skills).
- test (vitest run) -> Test Files 223 passed (223), Tests 2008 passed (2008).
  Baseline previo 1931; la 42 agrego 77 tests, sin regresion de la cadena de cierres 37/38/39/40/56/41.
- ./init.sh -> == init OK ==.
- Auditoria money-critical -> cero parseFloat/Number sobre montos en el flujo wallet (solo en comentarios).

## Commits del slice

- a9769ea feat(42): backend wallet (modelo, migracion, utils, repos, services, enganche cierre, server actions)
- f85ee42 feat(42): frontend wallet (pagina /wallet, libro, balance, filtros, movimiento manual)

## Archivos creados / modificados

Backend: db/schema.prisma (3 enums WalletMovimientoTipo/Categoria/OrigenTipo, modelo
WalletMovimiento, Usuario.walletMovimientosRegistrados, Orden.cobraComision Boolean default true
map cobra_comision); db/migrations/20260712160000_wallet_movimiento (migration.sql + down.sql);
lib/types/wallet.ts; lib/utils/ingreso-ordenex.ts; lib/utils/wallet-balance.ts;
lib/interfaces/repositories/IWalletMovimientoRepository.ts + ITarifaVigentePorZonaRepository.ts;
lib/interfaces/services/IWalletService.ts + IWalletFeedService.ts;
lib/repositories/WalletMovimientoRepository.ts + TarifaVigentePorZonaRepository.ts;
lib/services/WalletService.ts + WalletFeedService.ts; lib/actions/wallet.ts.
MOD money-critical: lib/repositories/CierresAdminRepository.ts (enganche T8: transaction +
inyeccion del feed/repo de wallet; alimenta solo si nuevoEstado=aprobado y count=1, misma tx
atomica R7, idempotente skipDuplicates ON CONFLICT DO NOTHING sobre unique parcial R6/R13);
lib/actions/cierres-admin.ts (buildService cablea las deps reales).

Frontend: app/(app)/wallet/page.tsx (Server Component role-aware maestro, pre-fetch props STRING);
app/(app)/wallet/_components: WalletModule, WalletLedger, WalletBalanceCard, WalletFiltros,
RegistrarMovimientoManualDialog, wallet-labels.ts.

Tests nuevos: tests/unit/utils/ingreso-ordenex.test.ts, wallet-balance.test.ts;
tests/unit/repositories/wallet-movimiento-repository.test.ts;
tests/unit/services/wallet-service.test.ts, wallet-feed-service.test.ts;
tests/unit/actions/wallet-actions.test.ts; tests/integration/db/wallet-migration.test.ts,
wallet-idempotencia.test.ts; tests/integration/wallet-page.test.tsx.
Tests MOD: cierres-admin-repository.test.ts (constructor nuevo + R5/R7/R12),
cierres-bodega-admin-service.test.ts (R11), zonas-migration.test.ts (excluye _wallet_movimiento).

## Mapa de trazabilidad R -> test (R1..R26, ninguno sin test)

- R1  wallet-service.test.ts (fila inmutable ingreso/egreso)
- R2  wallet-movimiento-repository.test.ts (persiste tipo/categoria/monto/origen/fecha)
- R3  wallet-service.test.ts (no update/delete; correccion = ajuste compensatorio)
- R4  wallet-balance.test.ts + ingreso-ordenex.test.ts (Decimal exacto, STRING 2 dec)
- R5  cierres-admin-repository.test.ts + wallet-feed-service.test.ts (aprobar inserta ingresos en tx)
- R6  wallet-idempotencia.test.ts + wallet-movimiento-repository.test.ts (skipDuplicates constraint DB)
- R7  cierres-admin-repository.test.ts (fallo de insert revierte la aprobacion por transaction)
- R8  ingreso-ordenex.test.ts (entregada esCentral/no + IVA flete; comision+IVA solo cobraComision=true; devuelta/rechazada flete devolucion + IVA; reprogramada sin ingreso)
- R9  ingreso-ordenex.test.ts + wallet-feed-service.test.ts (tarifa null -> todo 0.00 sin lanzar)
- R10 wallet-feed-service.test.ts + ingreso-ordenex.test.ts (1 mov/concepto hasta 6; omite 0.00)
- R11 cierres-bodega-admin-service.test.ts (aprobar bodega NO genera wallet_movimiento)
- R12 cierres-admin-repository.test.ts (vencido->aprobado alimenta una vez)
- R13 wallet-idempotencia.test.ts (reintento por par existente = no-op)
- R14 wallet-movimiento-repository.test.ts (egresos polimorficos)
- R15 wallet-service.test.ts + wallet-actions.test.ts (manual valido/inmutable)
- R16 wallet-balance.test.ts + wallet-movimiento-repository.test.ts (Sum ingreso-egreso, sin saldo almacenado)
- R17 wallet-balance.test.ts (positivo/negativo/cero, STRING+signo)
- R18 wallet-page.test.tsx (/wallet renderiza libro + balance)
- R19 wallet-service.test.ts + wallet-actions.test.ts + wallet-page.test.tsx (rol != maestro / sin sesion -> forbidden/notFound sin exponer)
- R20 wallet-movimiento-repository.test.ts + wallet-service.test.ts (filtros tipo/categoria/fecha en WHERE)
- R21 wallet-page.test.tsx (datos via Server Component -> props STRING, sin Decimal al cliente)
- R22 wallet-migration.test.ts (RLS ENABLE sin policies anon/authenticated)
- R23 wallet-migration.test.ts (down reversible orden inverso)
- R24 wallet-migration.test.ts (3 indices + unique parcial WHERE origen_id IS NOT NULL)
- R25 wallet-actions.test.ts (DTOs STRING en la frontera; transversal)
- R26 wallet-migration.test.ts (orden.cobra_comision BOOLEAN NOT NULL DEFAULT true; down DROP) + ingreso-ordenex.test.ts (lectura de cobraComision condiciona la comision)

## Decisiones / supuestos (revisables)

1. Tarifa vigente por zona (F1.4-Q1): tarifas es CRUD multi-fila sin flag de vigente unica;
   resolveTarifaPorZona elige la mas reciente no borrada (createdAt desc, deletedAt null); null -> gap R9.
2. Redondeo: Prisma.Decimal.toDecimalPlaces(2, ROUND_HALF_UP) por concepto; agregacion suma Decimal, salida toFixed(2).
3. montoCobrar null se trata como 0 (money-safe) al derivar comision.
4. Idempotencia: createMany con skipDuplicates -> ON CONFLICT DO NOTHING a nivel DB (R6, sin TOCTOU).
5. Rol UI autorizado = solo maestro (A4 default); admin sin lectura (R19).

## Riesgos / deuda

- DIFERIDO round-trip db:migrate/db:rollback REAL: la unica DB es un Supabase remoto compartido
  sin shadow/DIRECT URL (aplicar prisma migrate dev ahi es destructivo/puede colgar). NO ejecutado
  en esta sesion (mismo criterio que 39/56/40). Respaldo: prisma validate OK + test estatico
  wallet-migration.test.ts verde + SQL calcado del precedente cierre_bodega. Accion reviewer/human:
  correr el round-trip real en entorno controlado antes de merge a dev.
- A5 (deuda ya en el spec): la 42 anade y LEE orden.cobraComision pero NO expone su captura
  editable por-orden (14/15/16/17); hasta entonces todas las ordenes usan DEFAULT true.
- Acoplamiento a proposito: CierresAdminRepository ahora depende de wallet por inyeccion (repo
  orquesta la tx, service construye los movimientos). Cubierto por R5/R7/R12.
