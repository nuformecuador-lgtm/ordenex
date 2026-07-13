# Feature 43 — Wallet POR TIENDA — tasks.md

> Checklist discreta y verificable. `[P]` = paralelizable (sin dependencia de archivo con otra
> `[P]` del mismo bloque). Marcas de zona: **[BE]** backend, **[FE]** frontend. Toda task cierra
> con su criterio de "hecho". NO empezar hasta aprobación humana F1.4. Reutiliza la 42 (no
> reimplementar la fórmula). Baseline VERDE sobre `origin/dev` f25f4a8.

## Bloque 0 — Preparación

- [x] **T0** F1.4 **APROBADA 2026-07-12**: Q1 ledger, Q2 montoRecibido, **Q3 = opción 1 (saldo
  negativo por devolución) con interruptor reversible `TIENDA_DEBITA_FLETE_DEVOLUCION`, default
  `true`**, Q4 alcance = visibilidad, Q5 `/mi-wallet` + vista maestro, Q6 por concepto.
  **Hecho:** decisiones registradas en `requirements.md` (bloque "F1.4 APROBADA 2026-07-12");
  requisitos `[F1.4-Qn]` fijados; R10/R15 condicionados al flag; R28/R29 añadidos.

## Bloque 1 — Modelo de datos y migración (BE) — base de todo

- [x] **T1 [BE]** Añadir a `db/schema.prisma`: enums `WalletTiendaMovimientoTipo`,
  `WalletTiendaMovimientoCategoria`; modelo `WalletTiendaMovimiento` (con índices) y los lados
  inversos en `model Usuario`. Reutilizar `WalletOrigenTipo` existente.
  **Hecho:** `pnpm prisma validate` OK; `pnpm run typecheck` sin errores nuevos. (R1, R2)
- [x] **T2 [BE]** Migración `db/migrations/<ts>_wallet_tienda_movimiento/` con `migration.sql`
  (CREATE TYPE ×2, CREATE TABLE, índices, índice único parcial de idempotencia, ENABLE RLS sin
  policies, FKs a `usuario`) y `down.sql` reversible (DROP TABLE + DROP TYPE ×2).
  **Hecho:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte limpio. (R6, R24, R25, R26)
- [x] **T3 [BE]** `tests/integration/db/wallet-tienda-migration.test.ts`: RLS habilitada sin
  policies anon/authenticated; índices + unique parcial presentes; round-trip up/down.
  **Hecho:** test verde. (R24, R25, R26)

## Bloque 2 — Tipos, utilidades puras y mapeo (BE) — reutiliza la 42

- [x] **T4 [BE][P]** `lib/types/wallet-tienda.ts`: DTOs (montos STRING), schemas zod
  (`listarMovimientosTiendaSchema`), seeds con `satisfies` contra enums Prisma (patrón
  `lib/types/wallet.ts`).
  **Hecho:** typecheck OK; seed exhaustivo (rompe build si el enum cambia). (R4, R27)
- [x] **T5 [BE][P]** `lib/utils/saldo-tienda.ts` (`derivarSaldoTienda`, espejo de
  `wallet-balance.ts`, saldo puede ser negativo) + `lib/utils/mapeo-concepto-tienda.ts` (mapeo 1:1
  de los 6 conceptos de la 42 → categorías de débito). Tests puros
  `tests/unit/utils/saldo-tienda.test.ts`.
  **Hecho:** Decimal exacto, STRING 2 dec + signo; mapeo 1:1 verificado; tests verdes. (R4, R8, R16, R17)
- [x] **T5b [BE][P]** `lib/config/wallet-tienda.ts` — ÚNICA fuente de verdad del interruptor Q3
  (patrón `lib/config/cierre.ts`/`moneda.ts`): interface + `loadWalletTiendaConfig()` que lee
  env con fallback + singleton. Expone `TIENDA_DEBITA_FLETE_DEVOLUCION: boolean` DEFAULT `true`,
  sobreescribible por `WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION`.
  **Hecho:** typecheck OK; default `true` verificado en test unit; leído en un único punto. (R28)

## Bloque 3 — Repositorio del ledger (BE) — depende de T1/T4

- [x] **T6 [BE]** `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts`
  (`crearMovimientos(tx,movs)` idempotente, `listarPorTienda`, `agregarSaldoPorTienda`,
  `listarSaldosTodasTiendas`) + impl `lib/repositories/WalletTiendaMovimientoRepository.ts` (solo
  Prisma; `createMany({ skipDuplicates:true })`; filtros y acotado por `tienda_id` en el WHERE).
  **Hecho:** `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` verde. (R2, R6, R16, R19, R22)
- [x] **T7 [BE]** `tests/integration/db/wallet-tienda-idempotencia.test.ts`: doble inserción del
  mismo `(origen_tipo,origen_id,tienda_id,categoria)` = un solo movimiento (constraint DB).
  **Hecho:** test verde. (R6, R13)

## Bloque 4 — Feed service (BE) — CORAZÓN, reutiliza `derivarIngresoOrden` — depende de T5/T6

- [x] **T8 [BE]** `lib/interfaces/services/IWalletTiendaFeedService.ts` +
  `lib/services/WalletTiendaFeedService.ts`: `construirMovimientosPorTienda(cierreId, tx)`. Lee
  gestiones (con `orden.{tiendaId,zonaId,montoCobrar,cobraComision,zona.esCentral}`, `resultado`,
  `montoRecibido`), cachea tarifa por zona (reutiliza `resolveTarifaPorZona`), deriva débitos con
  `derivarIngresoOrden` (42) + crédito `cod_recaudado`, agrega por (tienda,concepto), omite 0.00.
  **Interruptor Q3 (R28):** lee `walletTiendaConfig.TIENDA_DEBITA_FLETE_DEVOLUCION` (único punto,
  de T5b); si es `false`, descarta `flete_devolucion`/`iva_flete_devolucion` del set de débitos de
  la tienda ANTES de agregar, sin tocar el crédito COD, el resto de débitos ni la 42.
  **Hecho:** devuelve filas `origen=cierre_dia` por tienda; con flag=false no incluye los 2
  débitos de devolución; typecheck OK. (R5, R8, R9, R10, R11, R14, R28)
- [x] **T9 [BE]** `tests/unit/services/wallet-tienda-feed-service.test.ts`: entregada (crédito COD
  + débitos flete/comisión/IVAs; comisión solo si `cobraComision`); devuelta/rechazada con
  **flag=true** (débitos devolución sin crédito → negativo) y con **flag=false** (NO emite
  `flete_devolucion`/`iva_flete_devolucion` en la tienda; el resto igual; 42 intacta);
  reprogramada (nada); `montoRecibido` null → crédito 0; zona sin tarifa → débitos 0.00 + crédito
  intacto; **default del flag = `true`** (R28); **invariante R15 en AMBOS estados del flag**
  (flag=true → saldo tienda + ingreso 42 = COD y Σ débitos_X tiendas = ingreso_X 42; flag=false →
  en devuelta/rechazada la diferencia = flete_dev+IVA y Σ_tiendas de esos débitos = 0.00);
  reversión histórica por ajuste compensatorio sin UPDATE/DELETE (R29).
  **Hecho:** todos los casos verdes en ambos estados del flag. (R8, R9, R10, R11, R14, R15, R28, R29)

## Bloque 5 — Enganche en el cierre (BE) — depende de T6/T8; toca archivo de la 42

- [x] **T10 [BE]** Extender `CierresAdminRepository`: inyectar
  `IWalletTiendaMovimientoRepository` + `IWalletTiendaFeedService`; en `resolverCierre`, dentro de
  la MISMA `$transaction` y tras la alimentación de la 42, construir e insertar los movimientos por
  tienda (idempotente). Actualizar el wiring/factory que instancia el repo.
  **Hecho:** `tests/unit/repositories/cierres-admin-repository.test.ts` cubre atomicidad (fallo →
  rollback de todo) y que solo `aprobado` alimenta. (R5, R7, R12, R13)
- [x] **T11 [BE]** Tests de servicio de cierres:
  `tests/unit/services/cierres-admin-service.test.ts` (aprobar CierreDia genera movimientos por
  tienda; vencido→aprobado una vez) y `tests/unit/services/cierres-bodega-admin-service.test.ts`
  (aprobar CierreBodega NO genera movimientos de tienda).
  **Hecho:** tests verdes. (R5, R12, R13)

## Bloque 6 — Service de lectura + Server Actions (BE) — depende de T6

- [x] **T12 [BE]** `lib/interfaces/services/IWalletTiendaService.ts` +
  `lib/services/WalletTiendaService.ts`: `verMiSaldo`/`listarMisMovimientos` (adminTienda, acotado
  a `actor.usuarioId`; forbidden si otro rol) y `listarSaldosTiendas` (solo maestro, R20).
  **Hecho:** `tests/unit/services/wallet-tienda-service.test.ts` cubre acotado por tienda,
  forbidden por rol, filtros en WHERE y vista maestro. (R16, R17, R19, R20, R22)
- [x] **T13 [BE]** `lib/actions/wallet-tienda.ts` (`'use server'`): `verMiSaldoAction`,
  `listarMisMovimientosAction`, `listarSaldosTiendasAction` (resuelve actor, zod en el borde,
  `withErrorHandler`; espejo de `lib/actions/wallet.ts`).
  **Hecho:** typecheck OK; unauthenticated/validation_error/forbidden mapeados. (R19, R20, R21, R27)

## Bloque 7 — Frontend (FE) — depende de T13 (contratos DTO)

- [x] **T14 [FE]** `app/(app)/mi-wallet/page.tsx` Server Component role-aware (`adminTienda`,
  `notFound` si no); pre-fetch acotado a `actor.usuarioId`; pasa datos STRING por props.
  **Hecho:** `tests/integration/mi-wallet-page.test.tsx` verde (5 casos) — adminTienda ve su saldo;
  otra tienda/rol → notFound; saldo negativo y montos como STRING (sin Decimal al cliente). (R18, R19, R21)
- [x] **T15 [FE][P]** Componentes `app/(app)/mi-wallet/_components/`: `MiWalletModule`,
  `SaldoTiendaCard` (signo/color, saldo puede ser negativo), `DesgloseTiendaLedger` (tabla por
  cierre/concepto), `MiWalletFiltros` (fecha/cierre/concepto), `mi-wallet-labels.ts`. shadcn/ui;
  datos por props (sin fetch propio); los filtros invocan `listarMisMovimientosAction`.
  **Hecho:** render con datos mock (integración); filtros invocan la Server Action; a11y (region
  "Saldo a favor", table "Desglose de movimientos"); E2E `e2e/mi-wallet.spec.ts` (acceso adminTienda
  + bloqueo rol no autorizado). (R18, R21, R22)
- [x] **T16 [FE][P]** Vista del maestro (R20, ruta A1/Q5):
  `app/(app)/wallet/tiendas/page.tsx` + `_components/SaldosTiendasTable.tsx`, role-aware `maestro`,
  pre-fetch `listarSaldosTiendasAction`, datos STRING por props (saldo por tienda puede ser negativo).
  **Hecho:** maestro ve saldos de todas las tiendas; otro rol → notFound. (R20, R21)

## Bloque 8 — Pago/liquidación (condicional F1.4-Q4) — solo si el humano lo incluye en la 43

- [x] **T17 [BE]** (SI Q4 = incluir pago) `registrarPagoTiendaAction` (maestro): en una tx,
  insertar `egreso_pago_tienda` en `wallet_movimiento` (42) + débito `pago_tienda` en el ledger de
  la tienda; idempotente por id de operación; atómico.
  **Hecho:** `tests/integration/db/wallet-tienda-pago.test.ts` verde. (R23)
  **SI Q4 = follow-up:** verificar solo que enum `pago_tienda`/`egreso_pago_tienda` quedan
  reservados y usables sin migración adicional (test de esquema). (R23)

## Bloque 9 — Cierre de la feature

- [x] **T18** Verificación transversal money-safe: ningún `parseFloat`/`Number(` sobre montos;
  todos los DTOs de monto/saldo son STRING (grep + asserts en tests).
  **Hecho:** grep limpio; asserts presentes. (R4, R27)
- [ ] **T19** `progress/impl_43-wallet-por-tienda.md` con el mapa `R1..R27 → test`, archivos
  tocados y salida de `pnpm test`/`typecheck`/`lint`.
  **Hecho:** mapa completo; `./init.sh` VERDE. (trazabilidad CHECKPOINTS)
- [ ] **T20** `pnpm run typecheck` + `pnpm run lint` + `pnpm test` verdes; sincronizar con
  `origin/dev`, resolver conflictos, push y `gh pr create --base dev`.
  **Hecho:** suite verde; PR abierto y reportado.

## Grafo de dependencias (resumen)

```
T0 → T1 → T2 → T3
     T1 → T4[P], T5[P] ;  T5b[P] (config, sin dep de esquema)
     T4,T6 ← T1 ;  T6 → T7
     T5,T5b,T6 → T8 → T9   (T8 lee el flag de T5b)
     T6,T8 → T10 → T11
     T6 → T12 → T13 → T14 → {T15[P], T16[P]}
     (cond) T6,T10 → T17
     todo → T18 → T19 → T20
```
