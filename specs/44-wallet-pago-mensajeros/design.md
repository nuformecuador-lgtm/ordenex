# Feature 44 — Wallet: pago a mensajeros y cuentas por pagar — design.md

> Decisiones técnicas. Pendiente F1.4 (ver `requirements.md`). Money-critical: `Prisma.Decimal`
> en todo cálculo, STRING `toFixed(2)` en la frontera, cero `parseFloat`/`Number(`. Patrón de
> capas Controller → Service → Repository con interfaces (`docs/architecture.md`). **Reutiliza
> los snapshots de 39/37 y el enganche de 42/43; NO recalcula el pago.** Precedente estructural:
> feature 43 (`specs/43-wallet-por-tienda/design.md`).

## 0. Principio rector: consumir el snapshot, no recalcular

Al aprobar un `CierreDia`, el pago debido y el efectivo ya están congelados:
`P = cierre_dia.total_pago_mensajero` (snapshot 39) y `E = cierre_dia.total_efectivo`
(snapshot 37). La 44:
- LEE esos dos `Decimal` del `cierre_dia` en la MISMA `tx` de la aprobación (no re-deriva
  tarifas ni recuenta gestiones; ese trabajo lo hizo la 39 al solicitar el cierre).
- Calcula `pagado = min(P, E)` y `pendiente = P − pagado` (money-safe, `Prisma.Decimal`).
- Congela dos movimientos por (mensajero, cierre): `pago_devengado = P` (tipo `devengo`) y
  `pago_efectivo = pagado` (tipo `pago`). La cuenta por pagar es el saldo derivado.
- Se engancha en el MISMO `resolverCierre` / misma `$transaction` que 42 y 43 (atomicidad R7),
  DESPUÉS de la alimentación de 42 y 43.

## 1. Modelo de datos (F1.4-Qa/Qb recomendación: LIBRO propio)

### 1.1 Enums Postgres nativos (patrón 42/43 `WalletMovimiento*`/`WalletTiendaMovimiento*`)

```
enum PagoMensajeroMovimientoTipo { devengo  pago  @@map("pago_mensajero_movimiento_tipo") }
// devengo = Ordenex le debe al mensajero (aumenta la cuenta por pagar).
// pago    = Ordenex ya le entregó (del efectivo recaudado, o liquidación posterior) → reduce la cuenta por pagar.

enum PagoMensajeroMovimientoCategoria {           // @@map("pago_mensajero_movimiento_categoria")
  // devengo
  pago_devengado          // = cierre_dia.total_pago_mensajero (snapshot 39)
  // pago
  pago_efectivo           // = min(P, E): parte tomada del efectivo recaudado AL APROBAR ("lo ya pagado")
  liquidacion             // pago/liquidación posterior de la cuenta por pagar (F1.4-Qf; RESERVADO)
  // ajustes manuales (inmutables, corrección compensatoria R3)
  ajuste_devengo
  ajuste_pago
}
```

`WalletOrigenTipo` (enum de la 42) YA incluye `cierre_dia`, `pago_mensajero` y `manual`: se
REUTILIZA, sin enum nuevo de origen (patrón idéntico a la 43). `cierre_dia` para el feed;
`pago_mensajero` para la liquidación (Qf); `manual` para ajustes.

### 1.2 Tabla `pago_mensajero_movimiento` (modelo Prisma `PagoMensajeroMovimiento`)

```
model PagoMensajeroMovimiento {
  id            String                            @id @default(uuid())
  mensajeroId   String                            @map("mensajero_id")  // FK -> usuario (rol mensajero)
  tipo          PagoMensajeroMovimientoTipo
  categoria     PagoMensajeroMovimientoCategoria
  monto         Decimal                           @db.Decimal(12, 2)    // > 0 (el signo lo da `tipo`)
  origenTipo    WalletOrigenTipo                  @map("origen_tipo")   // cierre_dia | pago_mensajero | manual
  origenId      String?                           @map("origen_id")     // NULL solo en manual
  descripcion   String?
  registradoPor String?                           @map("registrado_por")
  fechaMovimiento DateTime                        @default(now()) @map("fecha_movimiento")
  createdAt     DateTime                          @default(now()) @map("created_at")
  // SIN updatedAt / deletedAt: fila INMUTABLE (R3).

  mensajero     Usuario  @relation("PagoMensajeroMovimientoMensajero", fields: [mensajeroId], references: [id])
  registrador   Usuario? @relation("PagoMensajeroMovimientoRegistrador", fields: [registradoPor], references: [id])

  @@index([mensajeroId, fechaMovimiento])   // R26: saldo/listado por mensajero por fecha (desc)
  @@index([origenTipo, origenId])           // R26: movimientos de un origen (cierre)
  @@map("pago_mensajero_movimiento")
}
```

`model Usuario` gana los lados inversos `PagoMensajeroMovimiento[]` (mensajero y registrador);
ninguna columna nueva en tablas existentes.

Idempotencia (R6/R26), a mano en el SQL (Prisma no expresa índice único PARCIAL):

```sql
CREATE UNIQUE INDEX pago_mensajero_movimiento_origen_uq
  ON pago_mensajero_movimiento (origen_tipo, origen_id, mensajero_id, categoria)
  WHERE origen_id IS NOT NULL;
```

Insertar dos veces `(cierre_dia, <cierreId>, <mensajeroId>, pago_devengado)` viola el
constraint → la segunda es no-op vía `createMany({ skipDuplicates: true })` (ON CONFLICT DO
NOTHING). Sin check-then-insert (evita TOCTOU, R6). Manuales (`origen_id NULL`) quedan FUERA del
índice parcial.

### 1.3 RLS (R24)

`ALTER TABLE pago_mensajero_movimiento ENABLE ROW LEVEL SECURITY;` SIN políticas
`anon`/`authenticated` → acceso solo vía service role (idéntico a `wallet_movimiento`/
`wallet_tienda_movimiento`/`cierre_dia`). El acotado por mensajero (R20) se aplica en el WHERE
del repo, no en RLS.

### 1.4 Sin saldo almacenado (R14)

NO se crea columna/tabla de "cuenta por pagar actual". Se DERIVA:

```sql
SELECT
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'devengo'), 0) AS devengado,
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'pago'),    0) AS pagado
FROM pago_mensajero_movimiento
WHERE mensajero_id = $1 AND (<filtros opcionales: fecha/cierre>);
-- cuenta_por_pagar = devengado - pagado  (Prisma.Decimal en el repo/service, STRING toFixed(2))
```

## 2. Rutas y capas

### 2.1 Backend (`lib/`)

- `lib/types/wallet-mensajero.ts` — tipos de dominio + schemas zod, con `satisfies` contra los
  enums Prisma (patrón `lib/types/wallet-tienda.ts`): `PagoMensajeroMovimientoDTO` (montos
  STRING), `CuentaPorPagarDTO { devengado, pagado, cuentaPorPagar, signo }`,
  `CuentaPorPagarResumenDTO { mensajeroId, mensajeroNombre, devengado, pagado, cuentaPorPagar }`
  (vista del maestro), `ListarPagosMensajeroInput { page, pageSize, cierreId?, mensajeroId?,
  desde?, hasta? }`.
- `lib/utils/cuenta-por-pagar.ts` — `derivarCuentaPorPagar(devengado, pagado)` PURA (Decimal →
  STRING; nunca negativa en flujo normal) y `calcularSplitPago(P, E)` PURA →
  `{ devengado: P, pagado: min(P,E), pendiente: P−min(P,E) }` con `Prisma.Decimal`. Espejo
  estructural de `lib/utils/saldo-tienda.ts`. Fuente única de la regla `min(P,E)` (R9).
- `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` —
  `crearMovimientos(tx, movs)` (idempotente, acepta cliente de tx), `listarPorMensajero(filtros)`,
  `agregarCuentaPorPagar(mensajeroId, filtros)`, `listarCuentasPorPagarTodos()` (maestro, R18).
- `lib/interfaces/services/IWalletMensajeroFeedService.ts` —
  `construirMovimientosDePago(cierreId, tx)` → filas a insertar (devengo + pago), usado DENTRO
  de la aprobación del cierre. `tx` tipado a `Pick<PrismaClient, "cierreDia">`.
- `lib/interfaces/services/IWalletMensajeroService.ts` — `listarCuentasPorPagar(actor)`
  (maestro, R18/R19), `verMiCuentaPorPagar(actor)` + `listarMisPagos(input, actor)` (mensajero,
  acotado a `actor.usuarioId`, R20). Guardias de rol.
- `lib/repositories/PagoMensajeroMovimientoRepository.ts`, `lib/services/WalletMensajeroFeedService.ts`,
  `lib/services/WalletMensajeroService.ts`.
- `lib/actions/wallet-mensajero.ts` — Server Actions (`'use server'`): `listarCuentasPorPagarAction`
  (maestro), `verMiCuentaPorPagarAction` + `listarMisPagosAction` (mensajero). Resuelve actor vía
  `resolveActorFromSession`, valida rol, zod en el borde; espejo de `lib/actions/wallet-tienda.ts`.

### 2.2 Enganche en la aprobación del cierre (R5/R7 — MISMA tx que 42/43)

`CierresAdminRepository.resolverCierre` ya orquesta `$transaction` y alimenta 42 y 43. Se AÑADE
la alimentación del pago al mensajero EN EL MISMO bloque (todo-o-nada), DESPUÉS de 42/43:

```
resolverCierre(input):
  $transaction(tx =>
    1. updateMany cierreDia -> aprobado (guardado por estado+alcance)              // sin cambios
    2. SI count===1 Y nuevoEstado==='aprobado':
         movs42 = walletFeedService.construirMovimientosDeIngreso(cierreId, tx)     // 42 (existente)
         walletMovimientoRepo.crearMovimientos(tx, movs42)                          // 42 (existente)
         movs43 = walletTiendaFeedService.construirMovimientosPorTienda(cierreId,tx)// 43 (existente)
         walletTiendaMovimientoRepo.crearMovimientos(tx, movs43)                    // 43 (existente)
         movs44 = walletMensajeroFeedService.construirMovimientosDePago(cierreId,tx)// 44 (NUEVO)
         pagoMensajeroMovimientoRepo.crearMovimientos(tx, movs44)                   // 44 (NUEVO, idempotente)
         // F1.4-Qa (condicional): si se habilita el egreso en caja 42:
         //   walletMovimientoRepo.crearMovimientos(tx, [egresoPagoMensajero])      // 42 (egreso_pago_mensajero, P)
  )
```

- `CierresAdminRepository` recibe por constructor DOS dependencias nuevas
  (`IPagoMensajeroMovimientoRepository`, `IWalletMensajeroFeedService`), por inyección, igual
  que ya recibe las de 42 y 43. Se actualiza el wiring/factory en `lib/actions/cierres-admin.ts`
  (`buildService`), única ubicación de instanciación.
- Idempotencia (R6/R12): `createMany({ skipDuplicates: true })` sobre
  `pago_mensajero_movimiento_origen_uq`.
- Atomicidad (R7): mismo `$transaction`; si falla cualquier insert (42, 43 o 44), rollback total.
- `CierreBodega` (R11): NO se toca; se documenta y se añade test negativo.

> **`WalletMensajeroFeedService.construirMovimientosDePago(cierreId, tx)`** (R5/R8/R9/R10/R13):
> 1. Lee el cierre: `tx.cierreDia.findUnique({ where: { id: cierreId }, select: { mensajeroId,
>    totalPagoMensajero, totalEfectivo } })` (un solo read; los Decimal se leen como Decimal/STRING,
>    nunca number).
> 2. `P = new Prisma.Decimal(cierre.totalPagoMensajero.toFixed(2))`,
>    `E = new Prisma.Decimal(cierre.totalEfectivo.toFixed(2))`.
> 3. `pagado = P.lte(E) ? P : E` (money-safe min); `pendiente = P.sub(pagado)`.
> 4. Devuelve `CrearPagoMensajeroInput[]` con `origen_tipo=cierre_dia`, `origen_id=cierreId`,
>    `mensajero_id`, montos STRING: `[{ tipo:'devengo', categoria:'pago_devengado', monto:P }]`
>    solo si `P.gt(0)`, y `[{ tipo:'pago', categoria:'pago_efectivo', monto:pagado }]` solo si
>    `pagado.gt(0)`. SI `P = 0` devuelve `[]` (R10). NO persiste (lo hace el repo en la tx).
>
> **Reflejo del egreso en caja 42 (F1.4-Qa, condicional):** si se habilita, el mismo enganche
> añade a los movimientos de la 42 un `{ tipo:'egreso', categoria:'egreso_pago_mensajero',
> monto:P, origenTipo:'cierre_dia', origenId:cierreId }` (idempotente por el constraint existente
> de la 42; un egreso por cierre). La liquidación posterior (Qf) NO vuelve a emitir egreso en 42.

### 2.3 Frontend (`app/` + `components/`)

- **Maestro (R18/R19/R21/R22):** `app/(app)/wallet/mensajeros/page.tsx` — Server Component
  role-aware (`maestro`, `notFound` si no), espejo de `app/(app)/wallet/tiendas/page.tsx`;
  pre-fetch `listarCuentasPorPagarAction`, pasa datos STRING por props.
  `_components/CuentasPorPagarTable.tsx` (por mensajero: devengado / pagado / cuenta por pagar,
  signo/color) + `_components/DesglosePagosMensajero.tsx` (desglose por cierre, opcional) +
  filtros. shadcn/ui `Table`.
- **Mensajero (R20/R21, condicional Qe/A1):** `app/(app)/mis-pagos/page.tsx` — Server Component
  role-aware (`mensajero`, `notFound` si no), espejo de `app/(app)/mi-wallet/page.tsx`;
  pre-fetch acotado a `actor.usuarioId` (`verMiCuentaPorPagarAction` + `listarMisPagosAction`),
  props STRING. `_components/MisPagosModule.tsx`, `_components/CuentaPorPagarCard.tsx`,
  `_components/DesglosePagos.tsx`, `_components/mis-pagos-labels.ts`.

## 3. Contratos I/O (frontera Server Action → cliente)

```ts
type PagoMensajeroMovimientoDTO = {
  id: string;
  mensajeroId: string;
  tipo: "devengo" | "pago";
  categoria: string;                 // PagoMensajeroMovimientoCategoria
  monto: string;                     // Decimal → STRING 2 dec (R4/R27)
  origenTipo: string;                // cierre_dia | pago_mensajero | manual
  origenId: string | null;
  descripcion: string | null;
  fechaMovimiento: string;           // ISO
};

type CuentaPorPagarDTO = {
  devengado: string;                 // STRING 2 dec (Σ devengo)
  pagado: string;                    // STRING 2 dec (Σ pago) — "lo ya pagado"
  cuentaPorPagar: string;            // STRING 2 dec (devengado − pagado) — "lo pendiente"
  signo: "positivo" | "cero";        // nunca negativo en flujo normal (R16)
};

// Vista del maestro (R18): una fila por mensajero.
type CuentaPorPagarResumenDTO = {
  mensajeroId: string;
  mensajeroNombre: string;
  devengado: string;
  pagado: string;
  cuentaPorPagar: string;            // STRING 2 dec
};
```

Todos los montos STRING; ningún `number` cruza la frontera (R27).

## 4. Fórmula (regla `min(P,E)` — money-safe) + invariante

Por cada `CierreDia` aprobado, con `P = total_pago_mensajero` (39) y `E = total_efectivo` (37):

```
pagado    = min(P, E)          // Prisma.Decimal: P.lte(E) ? P : E
pendiente = P − pagado         // P.sub(pagado)

Movimientos congelados (omite montos 0.00):
  si P > 0        -> (devengo, pago_devengado, P)
  si pagado > 0   -> (pago,    pago_efectivo,  pagado)
  pendiente NO es fila: es el saldo derivado = Σdevengo − Σpago
```

**Invariante de cuadre (R15), verificable en test:**
- Por (mensajero, cierre): `pago_devengado = pago_efectivo + cuenta_por_pagar_generada`, con
  `cuenta_por_pagar_generada = P − pagado`. Trivial por construcción, pero se testea con montos
  reales (incl. `E = 0` → pendiente = P; `E ≥ P` → pendiente = 0; `P = 0` → sin filas).
- Agregado: `Σ(pago_devengado) = Σ(cierre_dia.total_pago_mensajero)` de los `CierreDia`
  aprobados.
- Si se emite el egreso en caja 42 (Qa): `Σ(egreso_pago_mensajero en 42) = Σ(pago_devengado) =
  Σ(total_pago_mensajero)`. Cuadre entre la caja 42 y el libro del mensajero.

Redondeo money-safe (`toDecimalPlaces(2, ROUND_HALF_UP)`), salida `toFixed(2)`. Los snapshots
ya vienen a escala 2, por lo que no hay pérdida.

## 5. Migración

`db/migrations/<timestamp>_pago_mensajero_movimiento/` (timestamp posterior a
`20260712170000_wallet_tienda_movimiento`; el orden se valida en
`tests/integration/db/*-migration.test.ts`):
- `migration.sql` (UP): `CREATE TYPE` de los 2 enums nuevos
  (`pago_mensajero_movimiento_tipo`, `pago_mensajero_movimiento_categoria`); `CREATE TABLE
  pago_mensajero_movimiento`; índices (`(mensajero_id, fecha_movimiento)`, `(origen_tipo,
  origen_id)`); índice único parcial de idempotencia; `ENABLE ROW LEVEL SECURITY` (sin
  policies); FK `mensajero_id → usuario` ON DELETE RESTRICT (convención de FK no-nullable,
  patrón `wallet_tienda_movimiento.tienda_id`) y FK `registrado_por → usuario` ON DELETE SET
  NULL. REUTILIZA el enum `wallet_origen_tipo` de la 42 (no crea enum de origen).
- `down.sql` (DOWN): `DROP TABLE pago_mensajero_movimiento;` `DROP TYPE` de los 2 enums propios
  (en orden inverso). NO toca `wallet_origen_tipo` (es de la 42). Reversible (R25).

Aditiva: no rompe lecturas existentes; ninguna columna nueva en tablas existentes (solo lados
inversos de relación en `usuario`).

## 6. Alternativas de diseño DESCARTADAS (obligatorio)

**Descartada (F1.4-Qb, principal): fila única "cuenta por pagar" con COLUMNA de estado mutable
(`pendiente` → `pagado`) que se UPDATE-a al liquidar.** Atractiva por su simplicidad de lectura
("una fila por mensajero, mira el estado"). Se descarta porque:
1. **Viola la inmutabilidad money-critical** (42/R3, 43/R3): mutar el estado de una fila
   financiera abre TOCTOU (dos liquidaciones concurrentes) y borra el historial de pagos
   parciales; la 42/43 ya establecieron el libro append-only como estándar.
2. **Se desincroniza:** un saldo/estado almacenado puede divergir de la suma real de
   movimientos; el saldo derivado (`Σdevengo − Σpago`) es la única fuente de verdad.
3. **No compone con liquidaciones parciales** (pagar parte de la cuenta por pagar): con
   append-only cada pago es un movimiento más y el saldo cae solo.
Queda como opción si el humano acepta perder trazabilidad e inmutabilidad a cambio de una tabla
más plana.

**Descartada (F1.4-Qa, secundaria): re-derivar el pago desde las tarifas/gestiones al aprobar,
ignorando el snapshot `total_pago_mensajero` de la 39.** Rompería el principio de snapshot
congelado (si la `TarifaZonaMensajero` cambia tras solicitar el cierre, el pago divergiría del
que se le mostró al mensajero y del que la 39 congeló). Se descarta: la 44 CONSUME el snapshot
de la 39, nunca lo recalcula.

**Descartada (F1.4-Qd): netear el efectivo acumulado a través de varios cierres del mismo
mensajero.** Permitiría "arrastrar" efectivo sobrante de un cierre a cubrir el pago de otro,
pero rompe la idempotencia por `(cierre)` y la limpieza del snapshot por cierre (un re-cálculo
al aprobar un cierre viejo afectaría a otros). Se netea POR CIERRE (R13).

**Descartada (F1.4-Qf): incluir el flujo completo de liquidación (comprobantes, conciliación
bancaria) en la 44.** Demasiado alcance para una feature money-critical; se entrega primero la
visibilidad correcta de lo pagado/pendiente y la liquidación se añade como follow-up sobre un
modelo ya probado (categoría `liquidacion` + `origen_tipo = pago_mensajero` ya reservados → sin
cambio de esquema).
