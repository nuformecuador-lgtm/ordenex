# Feature 44 — Wallet: pago a mensajeros y cuentas por pagar — tasks.md

> Checklist discreta y verificable. `[P]` = paralelizable (sin dependencia de archivo con otra
> `[P]` del mismo bloque). Marcas de zona: **[BE]** backend, **[FE]** frontend. Toda task cierra
> con su criterio de "hecho" y su LISTA DE ARCHIVOS esperados (rutas absolutas relativas a la
> raíz del worktree `R:/ark-studio/projects/ricardo/ordenex-f44/`), que el leader usa para
> validar conflictos entre features paralelas. NO empezar hasta aprobación humana F1.4. Reutiliza
> snapshots de 39/37 y el enganche de 42/43 (no recalcular el pago).

## Bloque 0 — Puerta de aprobación

- [x] **T0** F1.4: fijar Qa (egreso en caja 42 sí/no), Qb (append-only + saldo derivado), Qc
  (automático al aprobar), Qd (`min(P,E)`), Qe (vistas maestro + mensajero), Qf (liquidación =
  follow-up o incluida). **Hecho:** decisiones registradas en un bloque "F1.4 APROBADA" en
  `requirements.md`; requisitos `[F1.4-Qx]` fijados.
  - Archivos: `specs/44-wallet-pago-mensajeros/requirements.md`

## Bloque 1 — Modelo de datos y migración (BE) — base de todo

- [x] **T1 [BE]** Añadir a `db/schema.prisma`: enums `PagoMensajeroMovimientoTipo`,
  `PagoMensajeroMovimientoCategoria`; modelo `PagoMensajeroMovimiento` (con índices) y los lados
  inversos en `model Usuario`. Reutilizar `WalletOrigenTipo` existente.
  **Hecho:** `pnpm prisma validate` OK; `pnpm run typecheck` sin errores nuevos. (R1, R2)
  - Archivos: `db/schema.prisma`
- [x] **T2 [BE]** Migración `db/migrations/<ts>_pago_mensajero_movimiento/` con `migration.sql`
  (CREATE TYPE ×2, CREATE TABLE, índices, índice único parcial de idempotencia, ENABLE RLS sin
  policies, FKs a `usuario`) y `down.sql` reversible (DROP TABLE + DROP TYPE ×2; no toca
  `wallet_origen_tipo`).
  **Hecho:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte limpio. (R6, R24, R25, R26)
  - Archivos: `db/migrations/<ts>_pago_mensajero_movimiento/migration.sql`,
    `db/migrations/<ts>_pago_mensajero_movimiento/down.sql`
- [x] **T3 [BE]** Test estático/round-trip de la migración: RLS habilitada sin policies
  anon/authenticated; índices + unique parcial presentes; enums de la 42 intactos; orden de
  migraciones válido.
  **Hecho:** test verde. (R24, R25, R26)
  - Archivos: `tests/integration/db/pago-mensajero-migration.test.ts`

## Bloque 2 — Tipos y utilidades puras (BE) — depende de T1

- [x] **T4 [BE][P]** `lib/types/wallet-mensajero.ts`: DTOs (montos STRING), schemas zod
  (`listarPagosMensajeroSchema`), seeds con `satisfies` contra enums Prisma (patrón
  `lib/types/wallet-tienda.ts`).
  **Hecho:** typecheck OK; seed exhaustivo (rompe build si el enum cambia). (R4, R27)
  - Archivos: `lib/types/wallet-mensajero.ts`
- [x] **T5 [BE][P]** `lib/utils/cuenta-por-pagar.ts`: `calcularSplitPago(P, E)` (→ devengado /
  pagado=min(P,E) / pendiente, `Prisma.Decimal`) y `derivarCuentaPorPagar(devengado, pagado)`
  (→ STRING + signo, nunca negativo). Tests puros.
  **Hecho:** Decimal exacto, STRING 2 dec; `min(P,E)`, borde `P=0`/`E=0`/`E≥P` verificados;
  tests verdes. (R4, R9, R14, R16)
  - Archivos: `lib/utils/cuenta-por-pagar.ts`, `tests/unit/utils/cuenta-por-pagar.test.ts`

## Bloque 3 — Repositorio del libro (BE) — depende de T1/T4

- [x] **T6 [BE]** `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts`
  (`crearMovimientos(tx,movs)` idempotente, `listarPorMensajero`, `agregarCuentaPorPagar`,
  `listarCuentasPorPagarTodos`) + impl `lib/repositories/PagoMensajeroMovimientoRepository.ts`
  (solo Prisma; `createMany({ skipDuplicates:true })`; filtros y acotado por `mensajero_id` en
  el WHERE).
  **Hecho:** test de repo verde. (R2, R6, R14, R20, R22)
  - Archivos: `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts`,
    `lib/repositories/PagoMensajeroMovimientoRepository.ts`,
    `tests/unit/repositories/pago-mensajero-movimiento-repository.test.ts`
- [x] **T7 [BE]** Test de idempotencia por constraint DB: doble inserción del mismo
  `(origen_tipo, origen_id, mensajero_id, categoria)` = un solo movimiento.
  **Hecho:** test verde. (R6, R12)
  - Archivos: `tests/integration/db/pago-mensajero-idempotencia.test.ts`

## Bloque 4 — Feed service (BE) — CORAZÓN, consume snapshots 39/37 — depende de T5/T6

- [x] **T8 [BE]** `lib/interfaces/services/IWalletMensajeroFeedService.ts` +
  `lib/services/WalletMensajeroFeedService.ts`: `construirMovimientosDePago(cierreId, tx)`. Lee
  `cierre_dia.{mensajeroId, totalPagoMensajero, totalEfectivo}` (un solo `findUnique`), calcula
  `pagado=min(P,E)` y `pendiente`, emite `pago_devengado=P` (si P>0) y `pago_efectivo=pagado`
  (si pagado>0); pendiente derivado; P=0 → `[]`. NO re-deriva tarifas. Montos STRING.
  **Hecho:** devuelve filas `origen=cierre_dia` por mensajero; typecheck OK. (R5, R8, R9, R10, R13)
  - Archivos: `lib/interfaces/services/IWalletMensajeroFeedService.ts`,
    `lib/services/WalletMensajeroFeedService.ts`
- [x] **T9 [BE]** Tests del feed: `E≥P` (pagado=P, pendiente=0), `E<P` (pagado=E, pendiente=P−E,
  cuenta por pagar), `E=0` (todo pendiente), `P=0` (sin movimientos), netting por cierre (R13),
  invariante R15 (`pago_devengado = pago_efectivo + cuenta_por_pagar`; `Σdevengo =
  Σtotal_pago_mensajero`), montos STRING.
  **Hecho:** todos los casos verdes. (R8, R9, R10, R13, R15)
  - Archivos: `tests/unit/services/wallet-mensajero-feed-service.test.ts`

## Bloque 5 — Enganche en el cierre (BE) — depende de T6/T8; toca archivo de 42/43

- [x] **T10 [BE]** Extender `CierresAdminRepository`: inyectar
  `IPagoMensajeroMovimientoRepository` + `IWalletMensajeroFeedService`; en `resolverCierre`,
  dentro de la MISMA `$transaction` y TRAS la alimentación de 42/43, construir e insertar los
  movimientos del pago al mensajero (idempotente). **Si F1.4-Qa = sí:** añadir el egreso
  `egreso_pago_mensajero` (monto P) a los movimientos de la 42 en la misma tx. Actualizar el
  wiring en `lib/actions/cierres-admin.ts` (`buildService`).
  **Hecho:** test de repo cubre atomicidad (fallo → rollback de todo) y que solo `aprobado`
  alimenta. (R5, R7, R11, R12, R17)
  - Archivos: `lib/repositories/CierresAdminRepository.ts`, `lib/actions/cierres-admin.ts`,
    `tests/unit/repositories/cierres-admin-repository.test.ts`
- [x] **T11 [BE]** Tests de servicio de cierres: aprobar `CierreDia` genera movimientos del pago
  (y, si Qa, el egreso 42); `vencido→aprobado` una vez; aprobar `CierreBodega` NO genera
  movimientos del pago mensajero.
  **Hecho:** tests verdes. (R5, R11, R12)
  - Archivos: `tests/unit/services/cierres-admin-service.test.ts`,
    `tests/unit/services/cierres-bodega-admin-service.test.ts`

## Bloque 6 — Service de lectura + Server Actions (BE) — depende de T6

- [x] **T12 [BE]** `lib/interfaces/services/IWalletMensajeroService.ts` +
  `lib/services/WalletMensajeroService.ts`: `listarCuentasPorPagar` (maestro, R18/R19),
  `verMiCuentaPorPagar`/`listarMisPagos` (mensajero, acotado a `actor.usuarioId`; forbidden si
  otro rol).
  **Hecho:** test cubre acotado por mensajero, forbidden por rol, filtros en WHERE y vista
  maestro. (R3, R14, R16, R19, R20, R22)
  - Archivos: `lib/interfaces/services/IWalletMensajeroService.ts`,
    `lib/services/WalletMensajeroService.ts`,
    `tests/unit/services/wallet-mensajero-service.test.ts`
- [x] **T13 [BE]** `lib/actions/wallet-mensajero.ts` (`'use server'`):
  `listarCuentasPorPagarAction` (maestro), `verMiCuentaPorPagarAction`, `listarMisPagosAction`
  (mensajero). Resuelve actor, zod en el borde, `withErrorHandler`; espejo de
  `lib/actions/wallet-tienda.ts`.
  **Hecho:** typecheck OK; unauthenticated/validation_error/forbidden mapeados. (R19, R20, R21, R27)
  - Archivos: `lib/actions/wallet-mensajero.ts`,
    `tests/unit/actions/wallet-mensajero-actions.test.ts`

## Bloque 7 — Frontend (FE) — depende de T13 (contratos DTO)

- [x] **T14 [FE]** Vista del maestro (R18): `app/(app)/wallet/mensajeros/page.tsx` Server
  Component role-aware (`maestro`, `notFound` si no); pre-fetch `listarCuentasPorPagarAction`;
  props STRING. Componentes `_components/CuentasPorPagarTable.tsx` (+ desglose por cierre +
  filtros + labels). shadcn/ui; datos por props.
  **Hecho:** integración verde — maestro ve cuentas por pagar de todos; otro rol → notFound;
  montos como STRING. (R18, R19, R21, R22)
  **Fix review (R18/R22):** al EXPANDIR un mensajero, `DesglosePagosMensajero` carga client-side
  (SWR → `listarPagosDeMensajeroAction`) el DESGLOSE POR CIERRE paginado (más reciente primero) con
  filtros server-side por fecha/cierre; el saldo mostrado sale de `result.data.cuenta` (conjunto
  filtrado). Tests de desglose/filtros verdes en `wallet-mensajeros-page.test.tsx` + E2E extendido.
  - Archivos: `app/(app)/wallet/mensajeros/page.tsx`,
    `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx`,
    `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`,
    `app/(app)/wallet/mensajeros/_components/CuentasPorPagarFiltros.tsx`,
    `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts`,
    `tests/integration/wallet-mensajeros-page.test.tsx`
- [x] **T15 [FE][P]** (condicional F1.4-Qe/A1) Vista propia del mensajero (R20):
  `app/(app)/mis-pagos/page.tsx` Server Component role-aware (`mensajero`, `notFound` si no);
  pre-fetch acotado a `actor.usuarioId`; props STRING. Componentes `_components/MisPagosModule`,
  `CuentaPorPagarCard`, `DesglosePagos`, `mis-pagos-labels.ts`.
  **Hecho:** mensajero ve su cuenta por pagar y sus pagos; otro rol → notFound. (R20, R21)
  - Archivos: `app/(app)/mis-pagos/page.tsx`,
    `app/(app)/mis-pagos/_components/MisPagosModule.tsx`,
    `app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx`,
    `app/(app)/mis-pagos/_components/DesglosePagos.tsx`,
    `app/(app)/mis-pagos/_components/mis-pagos-labels.ts`,
    `tests/integration/mis-pagos-page.test.tsx`
- [x] **T16 [FE][P]** E2E: acceso del maestro a `/wallet/mensajeros` + bloqueo de rol no
  autorizado (y, si T15, acceso del mensajero a `/mis-pagos`).
  **Hecho:** E2E escrito. (R18, R19, R20)
  - Archivos: `e2e/wallet-mensajeros.spec.ts`

## Bloque 8 — Liquidación (condicional F1.4-Qf) — solo si el humano lo incluye en la 44

- [x] **T17 [BE]** (SI Qf = incluir liquidación) `registrarLiquidacionMensajeroAction`
  (maestro): en una tx, insertar `pago`/`liquidacion` (`origen_tipo=pago_mensajero`) en el libro
  del mensajero, reduciendo su cuenta por pagar; monto positivo ≤ cuenta por pagar vigente;
  idempotente por id de operación; NO emite egreso 42 nuevo.
  **Hecho:** `tests/integration/db/pago-mensajero-liquidacion.test.ts` verde. (R23)
  **SI Qf = follow-up:** verificar solo que la categoría `liquidacion` y `origen_tipo=pago_mensajero`
  quedan reservados y usables sin migración adicional (test de esquema). (R23)
  - Archivos: `lib/actions/wallet-mensajero.ts` (extender),
    `lib/services/WalletMensajeroService.ts` (extender),
    `tests/integration/db/pago-mensajero-liquidacion.test.ts`

## Bloque 9 — Cierre de la feature

- [x] **T18** Verificación transversal money-safe: ningún `parseFloat`/`Number(` sobre montos;
  todos los DTOs de monto/saldo son STRING (grep + asserts en tests).
  **Hecho:** grep limpio; asserts presentes. (R4, R27)
  - Archivos: (verificación; sin archivos nuevos)
- [x] **T19** `progress/impl_44-wallet-pago-mensajeros.md` con el mapa `R1..R27 → test`, archivos
  tocados y salida de `pnpm test`/`typecheck`/`lint`.
  **Hecho:** mapa completo; `./init.sh` VERDE. (trazabilidad CHECKPOINTS)
  - Archivos: `progress/impl_44-wallet-pago-mensajeros.md`
- [ ] **T20** `pnpm run typecheck` + `pnpm run lint` + `pnpm test` verdes; sincronizar con
  `origin/dev`, resolver conflictos, push y `gh pr create --base dev`.
  **Hecho:** suite verde; PR abierto y reportado.
  - Archivos: (proceso git; sin archivos nuevos)

## Grafo de dependencias (resumen)

```
T0 → T1 → T2 → T3
     T1 → T4[P], T5[P]
     T4,T6 ← T1 ;  T6 → T7
     T5,T6 → T8 → T9
     T6,T8 → T10 → T11
     T6 → T12 → T13 → T14 → {T15[P], T16[P]}
     (cond) T6,T12 → T17
     todo → T18 → T19 → T20
```

## Archivos que TOCA de otras features (riesgo de conflicto — para el leader)

- `db/schema.prisma` (añade enums/modelo + lados inversos en `Usuario`).
- `lib/repositories/CierresAdminRepository.ts` (nuevo enganche en `resolverCierre`).
- `lib/actions/cierres-admin.ts` (wiring `buildService`).
- `tests/unit/repositories/cierres-admin-repository.test.ts`,
  `tests/unit/services/cierres-admin-service.test.ts`,
  `tests/unit/services/cierres-bodega-admin-service.test.ts` (extienden cobertura).

> **Nota de conflicto:** estos archivos son los MISMOS que tocan 42 y 43. La 44 debe partir de
> `dev` con 42 y 43 ya mergeadas; el enganche se AÑADE tras el de 43 en `resolverCierre`.
