# Review — Feature 43: Wallet POR TIENDA (saldo a favor de la tienda)

Rama `feature/43-wallet-por-tienda`, commit `6923a7b` sobre `origin/dev` f25f4a8.
Reviewer independiente. Money-critical. Verificacion EJECUTABLE corrida por el reviewer.

## Veredicto: APROBADO
Bloqueantes: 0. Deudas menores: 3 (ninguna money-critical).

---

## Verificacion ejecutable (numeros reales corridos por el reviewer)
- `pnpm prisma validate` -> "The schema is valid".
- `pnpm run typecheck` (tsc --noEmit) -> **0 errores** (exit 0).
- `pnpm run lint` (eslint) -> **0 errores**, 135 warnings preexistentes solo en
  `.claude/skills/**` (minificados/scripts), ninguno de la 43.
- `pnpm test` (vitest run) -> **232 files / 2092 tests passed / 0 failed** (confirma el
  reporte del implementer; baseline 42 = 2008, +84 de la 43). Sin regresion de la cadena de
  cierres 37/38/39/40/56/41 ni de la wallet 42.
- `./init.sh` -> **== init OK ==** (exit 0): typecheck+lint+test verdes, todas las migraciones
  con down.sql, .env presente.

## Round-trip de la migracion — CORRIDO POR EL REVIEWER contra Postgres local (localhost:5432/ordenex)
Metodo: INTROSPECCION real (no regex) via PrismaClient+PrismaPg (`$queryRawUnsafe` sobre
`pg_type`/`pg_indexes`/`pg_class`/`pg_policies`), no la lectura estatica del test del implementer.
- **Estado inicial:** tabla `wallet_tienda_movimiento` presente; 3 enums
  (`wallet_tienda_movimiento_tipo`, `wallet_tienda_movimiento_categoria`, `wallet_origen_tipo`
  reusado de la 42); RLS = true, POLICIES = 0; indice UNICO PARCIAL
  `(origen_tipo, origen_id, tienda_id, categoria) WHERE origen_id IS NOT NULL` + los 3 indices
  normales (tienda+fecha, tienda+categoria, origen) + pkey.
- **`pnpm run db:rollback`:** ejecuto el down.sql -> introspeccion: tabla = NULL, quedan SOLO
  el enum `wallet_origen_tipo` (los 2 enums propios DROP), sin indices. El down NO toca el enum
  reusado de la 42. **Reversibilidad REAL confirmada.**
- **`prisma migrate deploy` (re-aplica):** introspeccion -> tabla, 3 enums, RLS on/0 policies,
  unique parcial e indices restaurados IDENTICOS; `prisma migrate status` = "up to date".

## Puntos money-critical auditados
1. **Reutilizacion estricta de la 42 (Q1/Q2):** `WalletTiendaFeedService` deriva los DEBITOS con
   `derivarIngresoOrden` (42) mapeados 1:1 (`mapeo-concepto-tienda.ts`, `satisfies` total) y el
   CREDITO `cod_recaudado` con `gestion_orden.montoRecibido` (null -> 0). La comision sigue basada
   en `montoCobrar` (herencia de la 42, NO alterada; verificado en el codigo y en el test). Cero
   duplicacion de formula. OK.
2. **INVARIANTE DE CUADRE R15 (lo mas importante) — verificado a mano por el reviewer:**
   - flag=TRUE (test): entregada cod=10000 con debitos flete1000+iva130+com500+ivacom65 +
     devuelta flete_dev400+iva52. saldo=10000-2147=7853; ingreso42=2147; 7853+2147=10000=COD. Cuadra
     EXACTO. Y a nivel concepto Sum debitos_X tiendas = ingreso_X 42 (asserts presentes).
   - flag=FALSE (test): devuelta no emite los 2 debitos en la tienda; saldo tienda=0; ingreso42
     intacto=452; diferencia COD-(saldo+ingreso)=452=flete_dev+IVA absorbido por Ordenex; Sum_tiendas
     de esos debitos=0.00. Cuadra EXACTO. El test corre AMBOS estados del flag. Cero parseFloat/Number.
3. **Flag reversible (Q3/R28/R29):** unica fuente de verdad `lib/config/wallet-tienda.ts`, default
   `true`, override por env `WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION`; leido en UN solo punto
   (`this.config.TIENDA_DEBITA_FLETE_DEVOLUCION`, una vez, en el feed). En `false` no emite
   `flete_devolucion`/`iva_flete_devolucion` en el ledger de la tienda y NO toca la 42. Reversion
   historica por ajuste compensatorio append-only (R29, cubierto por test + idempotencia manuales).
   Ambos caminos con test. OK.
4. **Idempotencia + atomicidad (R6/R7):** el feed 43 corre en la MISMA `$transaction` de
   `resolverCierre`, TRAS la 42; `createMany({ skipDuplicates:true })` sobre el unique parcial
   4-columnas (verificado en DB). Test R7: si el insert 43 falla, la tx propaga (rollback de todo,
   incluida la 42). Re-aprobar / vencido->aprobado no duplica (R13, constraint DB + test). La 42 y
   su guardia de transicion no se debilitaron (test cierres-bodega: bodega NO alimenta el ledger de
   tienda, R12). OK.
5. **Ledger inmutable + saldo derivado (R1/R3/R16):** tabla sin `updated_at`/`deleted_at`; el
   service no expone update/delete; saldo = groupBy SUM(monto) por tipo (credito-debito), puede ser
   negativo; nunca saldo almacenado. OK.
6. **Alcance (Q4):** la 43 solo modela + visibiliza. `pago_tienda`/`egreso_pago_tienda` quedan
   RESERVADOS (enum) y verificados usables sin migracion adicional (test R23); no hay flujo de pago
   a medias. OK.
7. **RLS e indices (R24/R26):** confirmado por introspeccion en DB (arriba). OK.
8. **UI + autorizacion (Q5/R18-R21):** `/mi-wallet` role-aware server-side: no `adminTienda` ->
   `notFound()` sin exponer datos; acotado a `actor.usuarioId` SIEMPRE en el WHERE del repo (nunca
   en memoria). `/wallet/tiendas` solo `maestro`. Datos financieros pre-obtenidos en Server
   Component y pasados YA como STRING (DTOs con monto STRING; el cliente no recibe `Prisma.Decimal`).
   E2E `e2e/mi-wallet.spec.ts` cubre acceso adminTienda + bloqueo de rol no autorizado. OK.

## Checklist CHECKPOINTS
- [x] requirements.md EARS numerado (R1..R29) + bloque F1.4 APROBADA.
- [x] design.md con alternativas descartadas (Q1 on-the-fly, Q6 neto, Q4 liquidacion completa, Q3 columna DB).
- [~] tasks.md: T0..T18 en `[x]`; **T19 y T20 en `[ ]`** (ver deuda menor 3).
- [x] Cada R<n> mapea a >=1 test concreto con asserts reales (mapa en impl_43).
- [x] typecheck / lint / test verdes (numeros arriba).
- [x] Flujo critico (recaudo/saldo) con E2E (`e2e/mi-wallet.spec.ts`).
- [x] Tabla nueva con RLS activada (verificado en DB).
- [x] Migracion reversible con down.sql y `db:rollback` funcional (round-trip real corrido).
- [x] Sin secretos hardcodeados; flag por env con default en config.
- [x] Capas: controller(page/action) sin queries; service sin HTTP; repo solo Prisma; interfaces en lib/interfaces.
- [x] Paginas protegidas validan rol server-side; componentes reciben datos por props (STRING).
- [x] Sin hardcode de pais/moneda/contexto.
- [x] `./init.sh` verde.

## Hallazgos
- **menor 1 (deuda, aceptada como la 42):** `e2e/mi-wallet.spec.ts` esta ESCRITO pero NO
  EJECUTADO (sin entorno seed), misma convencion diferida del resto de e2e del repo (incl.
  `e2e/wallet.spec.ts` de la 42). Cubre ambos flujos requeridos. No bloqueante.
- **menor 2 (observacion):** `tests/integration/db/wallet-tienda-migration.test.ts` es ESTATICO
  (regex sobre migration.sql/down.sql), no toca Postgres. El round-trip REAL lo corrio el reviewer
  por introspeccion (arriba) y paso; la cobertura queda cubierta. Recomendacion futura: promover a
  integracion real como el resto.
- **menor 3 (bookkeeping):** en `tasks.md`, **T19 y T20 quedaron en `[ ]`**. T19 (impl log) SI
  existe y esta completo (`progress/impl_43-wallet-por-tienda.md` con mapa R1..R29). T20 es el
  push/PR (accion de cierre del leader). CHECKPOINTS pide "todas las tasks `[x]`": marcar T19 (ya
  hecho) y cerrar T20 al abrir el PR. No bloqueante (deliverable de T19 presente; T20 es paso de
  cierre concurrente al review).

## Conclusion
Sin bloqueantes. El invariante de cuadre R15 cuadra EXACTO en ambos estados del flag (verificado a
mano), la idempotencia+atomicidad estan garantizadas por constraint DB (verificado por
introspeccion) dentro de la misma tx que la 42, y la reversibilidad de la migracion es REAL.
**APROBADO** con 3 deudas menores.
