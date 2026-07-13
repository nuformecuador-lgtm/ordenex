# Feature 42 — Wallet: caja PRINCIPAL de Ordenex — tasks.md

> Checklist discreto y verificable. `[P]` = paralelizable (sin dependencia entre sí).
> F1.4 APROBADA 2026-07-12 (ver `requirements.md`): listo para implementar. Money-critical: `Prisma.Decimal`
> + STRING `toFixed(2)`; cero `parseFloat`/`Number(`. Cada task cierra con su criterio de "hecho".
> Zona sugerida: T1–T7,T14–T16 = backend; T10–T13 = frontend; T8–T9 = backend (enganche cierre).

## Fase A — Modelo y migración (backend)

- [x] **T1 — Enums + tabla Prisma + columna `orden.cobraComision`.** En `db/schema.prisma`: enums
  `WalletMovimientoTipo`, `WalletMovimientoCategoria` (6 categorías `ingreso_*` incl.
  `ingreso_flete_devolucion` e `ingreso_iva_flete_devolucion`), `WalletOrigenTipo`; modelo
  `WalletMovimiento` (§1.2 del design); lado inverso `Usuario.walletMovimientosRegistrados`
  (relación `WalletMovimientoRegistrador`); **`model Orden` gana
  `cobraComision Boolean @default(true) @map("cobra_comision")` (R26).**
  **Hecho:** `prisma validate` OK; `prisma generate` sin errores; typecheck 0.

- [x] **T2 — Migración aditiva up/down.** `db/migrations/<timestamp>_wallet_movimiento/`:
  `migration.sql` (CREATE TYPE ×3, CREATE TABLE, 3 índices, índice único parcial
  `wallet_movimiento_origen_categoria_uq WHERE origen_id IS NOT NULL`, `ENABLE ROW LEVEL SECURITY`
  sin policies, FK `registrado_por`→`usuario`, **`ALTER TABLE orden ADD COLUMN cobra_comision
  boolean NOT NULL DEFAULT true` (R26)**); `down.sql` (`ALTER TABLE orden DROP COLUMN
  cobra_comision`, DROP TABLE + DROP TYPE ×3). **Depende:** T1. **Hecho:** `db:migrate` aplica;
  `db:rollback` revierte limpio; test de migración (R22/R23/R24/R26) verde: RLS habilitada sin
  policies anon/authenticated, índices y unique parcial presentes, `orden.cobra_comision`
  presente `NOT NULL DEFAULT true` con filas existentes en `true` (retro-compat), round-trip
  up/down.
  > NOTA (implementer 2026-07-12): `prisma validate` OK + test estático `wallet-migration.test.ts`
  > verde (RLS sin policies, 3 índices + unique parcial, `orden.cobra_comision`, down reversible).
  > El `db:migrate`/`db:rollback` REAL contra Postgres queda DIFERIDO: la única DB configurada es
  > un Supabase remoto compartido sin shadow/DIRECT URL (aplicar ahí es destructivo) — se verifica
  > en entorno controlado, mismo criterio que 39/56/40. Ver `progress/impl_42-wallet-caja-principal.md`.

## Fase B — Utilidades puras y tipos (backend) `[P]` entre sí tras T1

- [x] **T3 [P] — Tipos + zod.** `lib/types/wallet.ts`: `WalletMovimientoDTO`, `WalletBalanceDTO`,
  `RegistrarMovimientoManualInput` (monto>0, descripción obligatoria), `ListarMovimientosInput`
  (page/pageSize acotado, filtros tipo/categoria/desde/hasta). **Hecho:** montos tipados STRING;
  schemas zod validan bordes; typecheck 0.

- [x] **T4 [P] — Util ingreso Ordenex.** `lib/utils/ingreso-ordenex.ts`: `derivarIngresoOrden`
  (ramifica por `resultado`, §4) y `agregarIngresosPorConcepto` (`Prisma.Decimal`, `toFixed(2)`;
  `tarifa===null`→`0.00`; omite conceptos con total `0.00`). **Hecho:** tests unitarios (R8/R9/R26)
  cubren: `entregada` con esCentral vs no-central (flete + IVA flete); `entregada` con
  `cobraComision=true` (comisión % de `montoCobrar` + IVA comisión) vs `cobraComision=false` (sin
  comisión ni su IVA); `devuelta`/`rechazada` con flete de devolución (esCentral vs no) + IVA
  flete devolución (mismo `ivaFlete`%), sin comisión; `reprogramada` sin ingreso; gap sin tarifa
  → todo `0.00`; cero `number/parseFloat`.

- [x] **T5 [P] — Util balance.** `lib/utils/wallet-balance.ts`: `derivarBalance(ingresos,egresos)`
  → STRING + signo. **Hecho:** tests (R16/R17) balance positivo/negativo/cero, Decimal exacto.

## Fase C — Repositorios e interfaces (backend)

- [x] **T6 — Repo movimientos + resolver tarifa.** Interfaces
  `IWalletMovimientoRepository` (crearMovimientos con cliente tx + `ON CONFLICT DO NOTHING`,
  listar con filtros, agregarBalance) e `ITarifaVigentePorZonaRepository` (`resolveTarifaPorZona`,
  excluye `deletedAt`); impls `WalletMovimientoRepository`, `TarifaVigentePorZonaRepository`.
  **Depende:** T1,T3. **Hecho:** tests (R2/R6/R13/R14/R20/R24) — persiste campos, idempotencia por
  constraint DB, filtros en WHERE, balance agregado; montos STRING.

## Fase D — Servicios (backend)

- [x] **T7 — WalletService + WalletFeedService.** `IWalletService`/`WalletService`
  (listarMovimientos, verBalance, registrarMovimientoManual con guardia de rol maestro y R3
  inmutable); `IWalletFeedService`/`WalletFeedService` (`construirMovimientosDeIngreso(cierreId,tx)`
  usando T4 + resolver tarifa por zona + TODAS las gestiones del cierre —ramifica por `resultado`,
  lee `orden.cobraComision` y `zona.esCentral`—, agregado por concepto, omitiendo conceptos con
  total `0.00`). **Depende:** T4,T5,T6. **Hecho:** tests (R1/R3/R5/R10/R15/R19/R20) — construye
  hasta 6 movimientos por concepto; cierre solo con `entregada`+comisión vs cierre con devoluciones
  vs cierre sin comisión (no emite conceptos en 0.00); rol no autorizado→forbidden; manual
  válido/inmutable (si Q6).

## Fase E — Enganche en la aprobación del cierre (backend) — CRÍTICO

- [x] **T8 — Transacción en `resolverCierre`.** Envolver `CierresAdminRepository.resolverCierre`
  en `prisma.$transaction`: mantener el `updateMany` actual; SI `nuevoEstado==='aprobado'` y
  `count===1`, construir movimientos (T7) e insertarlos idempotentemente en la MISMA tx. Inyectar
  `IWalletMovimientoRepository` + `IWalletFeedService` por constructor (no lógica en el repo).
  Actualizar `lib/actions/cierres-admin.ts` / composición para pasar las nuevas deps.
  **Depende:** T6,T7. **Hecho:** tests (R5/R7/R12) — aprobar genera ingresos; fallo de insert
  revierte la aprobación (tx); vencido→aprobado alimenta una vez; comportamiento previo
  (conflict/fuera_de_alcance) intacto.

- [x] **T9 — Idempotencia + no-doble-conteo (integración DB).** Test de integración
  `tests/integration/db/wallet-idempotencia.test.ts` (R6/R13) doble aprobación = un solo set; y
  test negativo (R11) `CierresBodegaAdminService`/aprobar bodega NO genera `wallet_movimiento`.
  **Depende:** T8. **Hecho:** ambos verdes; fuente única = `CierreDia`.

## Fase F — Server Actions + UI (frontend, tras backend listo)

- [x] **T10 — Server Actions.** `lib/actions/wallet.ts` (`'use server'`): listar, verBalance,
  registrarMovimientoManual (si Q6); rol vía `cookies()`, zod en el borde, salida STRING.
  **Depende:** T7. **Hecho:** tests (R19/R21/R25) — forbidden sin rol; DTOs STRING.

- [x] **T11 [P] — Página `/wallet`.** `app/(dashboard)/wallet/page.tsx` Server Component:
  valida rol maestro, pre-fetch movimientos+balance, pasa por props; no autorizado→redirect.
  **Depende:** T10. **Hecho:** test de integración (R18/R19/R21) renderiza libro+balance; datos por
  props, sin Decimal al cliente.

- [x] **T12 [P] — Componentes private.** `WalletLedger`, `WalletBalanceCard`, `WalletFiltros`
  (shadcn/ui; sin fetch propio). **Depende:** T11. **Hecho:** balance +/− con estilo; filtros
  disparan la Server Action; render con datos de props.

- [x] **T13 [P] — Diálogo manual (solo si F1.4-Q6 aprobado).** `RegistrarMovimientoManualDialog`
  usa la Server Action (mutación interna, no `fetch`). **Depende:** T10. **Hecho:** crea ajuste
  ingreso/egreso; monto>0 y descripción obligatoria validados; movimiento inmutable.

## Fase G — Cierre de calidad

- [x] **T14 — Trazabilidad R→test.** Completar el mapa `R1..R26 → test` en
  `progress/impl_42-wallet-caja-principal.md`; ningún R sin test (incluye R26: columna
  `cobra_comision` + su lectura condicionando la comisión). **Hecho:** tabla completa; el
  reviewer puede verificarla.

- [x] **T15 — Suite + init verdes.** `./init.sh` y la suite completa en verde; typecheck 0;
  `prisma validate` OK; sin `parseFloat`/`Number(` sobre montos (grep). **Hecho:** todo verde.

- [x] **T16 — Auditoría money-critical.** Grep de `number`/`parseFloat` en el flujo de wallet;
  verificar STRING `toFixed(2)` en toda la frontera; confirmar RLS sin policies y `down.sql`
  reversible. **Hecho:** checklist de `CHECKPOINTS.md` y `docs/verification.md` satisfecho.

- [x] **T17 — E2E de `/wallet` (loose-end del review, R18–R21).** `e2e/wallet.spec.ts`: acceso
  `maestro` (balance derivado + libro + filtro por tipo + movimiento manual con descripción
  obligatoria) y bloqueo del rol NO autorizado (`mensajero` → `notFound`, sin balance ni
  movimientos). **Hecho:** typecheck 0, lint 0 errores, vitest 2008/2008 (los `.spec.ts` de
  Playwright NO los corre vitest → conteo intacto). Escrito y DIFERIDO como el resto de la cadena
  de cierres (mismo patrón de deferral de `e2e/cierres-admin.spec.ts`).

## Notas de partición para el implementer

- **Backend primero** (T1–T9, T14–T16 core), **frontend después** (T10–T13, `depends_on` backend).
- T4/T5/T3 son `[P]` una vez existe el modelo (T1). T11/T12/T13 son `[P]` tras T10.
- **T8 es el punto de mayor riesgo** (toca un repo de cierres money-critical con estado VERDE):
  cambio mínimo, por inyección, con tests de atomicidad e idempotencia antes de dar por hecho.
