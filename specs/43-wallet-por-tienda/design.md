# Feature 43 — Wallet POR TIENDA (saldo a favor de la tienda) — design.md

> Decisiones técnicas. Pendiente F1.4 (ver `requirements.md`). Money-critical: `Prisma.Decimal`
> en todo cálculo, STRING `toFixed(2)` en la frontera, cero `parseFloat`/`Number(`. Patrón de
> capas Controller → Service → Repository con interfaces (`docs/architecture.md`). Baseline
> VERDE sobre `origin/dev` f25f4a8. **Reutiliza la feature 42; NO reimplementa la fórmula.**

## 0. Principio rector: complemento exacto de la 42

El saldo de la tienda por orden es el COMPLEMENTO del ingreso de Ordenex de la 42:
`saldo = COD recaudado − (flete + comisión + IVA flete + IVA comisión)`. Por tanto la 43:
- REUTILIZA `lib/utils/ingreso-ordenex.ts` (`derivarIngresoOrden`, `agregarIngresosPorConcepto`)
  para los DÉBITOS (los 6 conceptos que Ordenex se queda) — misma función, sin duplicar fórmula.
- REUTILIZA `ITarifaVigentePorZonaRepository.resolveTarifaPorZona` (42) — mismo resolver de tarifa.
- Se engancha en el MISMO `resolverCierre` / misma `$transaction` que la 42 (atomicidad R7).
- Añade UN dato propio: el CRÉDITO `cod_recaudado = gestion_orden.montoRecibido` (Q2).

## 1. Modelo de datos (F1.4-Q1 recomendación: LEDGER)

### 1.1 Enums Postgres nativos (patrón 42 `WalletMovimiento*`)

```
enum WalletTiendaMovimientoTipo { credito  debito  @@map("wallet_tienda_movimiento_tipo") }
// credito = a favor de la tienda (COD recaudado); debito = descuento de Ordenex o pago.

enum WalletTiendaMovimientoCategoria {           // @@map("wallet_tienda_movimiento_categoria")
  // crédito (a favor de la tienda)
  cod_recaudado           // = gestion_orden.montoRecibido (Q2)
  // débitos (espejo 1:1 de los 6 conceptos de ingreso de la 42, R8)
  flete
  flete_devolucion
  comision_cod
  iva_flete
  iva_flete_devolucion
  iva_comision_cod
  // pago/liquidación (F1.4-Q4; RESERVADO aunque el pago sea follow-up)
  pago_tienda
  // ajustes manuales (inmutables, corrección compensatoria R3)
  ajuste_credito
  ajuste_debito
}
```

`WalletOrigenTipo` (enum de la 42) YA incluye `cierre_dia`, `pago_tienda` y `manual`: se
REUTILIZA, sin enum nuevo de origen. Reservar valores por adelantado sigue el patrón "reservar
valores del enum" (37/42).

### 1.2 Tabla `wallet_tienda_movimiento` (modelo Prisma `WalletTiendaMovimiento`)

```
model WalletTiendaMovimiento {
  id            String                          @id @default(uuid())
  tiendaId      String                          @map("tienda_id")     // FK -> usuario (rol adminTienda)
  tipo          WalletTiendaMovimientoTipo
  categoria     WalletTiendaMovimientoCategoria
  monto         Decimal                         @db.Decimal(12, 2)    // > 0 (el signo lo da `tipo`)
  origenTipo    WalletOrigenTipo                @map("origen_tipo")   // cierre_dia | pago_tienda | manual
  origenId      String?                         @map("origen_id")     // NULL solo en manual
  descripcion   String?
  registradoPor String?                         @map("registrado_por")
  fechaMovimiento DateTime                      @default(now()) @map("fecha_movimiento")
  createdAt     DateTime                        @default(now()) @map("created_at")
  // SIN updatedAt / deletedAt: fila INMUTABLE (R3).

  tienda        Usuario  @relation("WalletTiendaMovimientoTienda", fields: [tiendaId], references: [id])
  registrador   Usuario? @relation("WalletTiendaMovimientoRegistrador", fields: [registradoPor], references: [id])

  @@index([tiendaId, fechaMovimiento])   // R26: saldo/listado por tienda por fecha (desc)
  @@index([tiendaId, categoria])         // R26: filtro por concepto por tienda
  @@index([origenTipo, origenId])        // R26: movimientos de un origen (cierre)
  @@map("wallet_tienda_movimiento")
}
```

Idempotencia (R6/R26), a mano en el SQL (Prisma no expresa índice único PARCIAL):

```sql
CREATE UNIQUE INDEX wallet_tienda_movimiento_origen_uq
  ON wallet_tienda_movimiento (origen_tipo, origen_id, tienda_id, categoria)
  WHERE origen_id IS NOT NULL;
```

Insertar dos veces `(cierre_dia, <cierreId>, <tiendaId>, flete)` viola el constraint → la segunda
es no-op vía `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING). Sin check-then-insert
(evita TOCTOU, R6). Manuales (`origen_id NULL`) quedan FUERA del índice parcial.

### 1.3 RLS (R24)

`ALTER TABLE wallet_tienda_movimiento ENABLE ROW LEVEL SECURITY;` SIN políticas
`anon`/`authenticated` → acceso solo vía service role (idéntico a `wallet_movimiento`/
`cierre_dia`). El acotado por tienda (R19) se aplica en el WHERE del repo, no en RLS.

### 1.4 Sin saldo almacenado (R16)

NO se crea columna/tabla de "saldo actual" por tienda. El saldo se DERIVA:

```sql
SELECT
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'credito'), 0) AS creditos,
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'debito'),  0) AS debitos
FROM wallet_tienda_movimiento
WHERE tienda_id = $1 AND (<filtros opcionales: fecha/cierre/concepto>);
-- saldo = creditos - debitos  (Prisma.Decimal en el repo/service, STRING toFixed(2), signo)
```

## 2. Rutas y capas

### 2.1 Backend (`lib/`)

- `lib/types/wallet-tienda.ts` — tipos de dominio + schemas zod, con `satisfies` contra los enums
  Prisma (patrón de `lib/types/wallet.ts`): `WalletTiendaMovimientoDTO` (montos STRING),
  `SaldoTiendaDTO { creditos, debitos, saldo, signo }` (reutiliza la forma de `WalletBalanceDTO`),
  `ListarMovimientosTiendaInput { page, pageSize, cierreId?, categoria?, desde?, hasta? }`. Lista
  de los 6 conceptos de débito como espejo de `WALLET_INGRESO_CONCEPTO_SEED` (mapeo 1:1, R8).
- `lib/utils/saldo-tienda.ts` — `derivarSaldoTienda(creditos, debitos)` PURA (Decimal → STRING +
  signo, puede ser negativo). Espejo estructural de `lib/utils/wallet-balance.ts`.
- `lib/utils/mapeo-concepto-tienda.ts` — mapeo puro `ingreso_flete → flete`, etc. (los 6
  conceptos de 42 → categorías de débito de 43). Fuente única del mapeo 1:1 (R8).
- `lib/config/wallet-tienda.ts` — **ÚNICA fuente de verdad del interruptor Q3** (R28). Sigue el
  patrón `lib/config/cierre.ts`/`moneda.ts` (interface + `loadWalletTiendaConfig()` que lee env
  con fallback + singleton exportado). Expone `TIENDA_DEBITA_FLETE_DEVOLUCION: boolean`, DEFAULT
  `true`, sobreescribible por env (`WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION`). NINGÚN otro archivo
  decide la regla Q3: el feed lo lee de aquí (ver 2.2). No es columna de DB (el repo no tiene
  patrón de settings en tabla; es config de módulo como el resto).
- `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` —
  `crearMovimientos(tx, movs)` (idempotente, acepta cliente de tx), `listarPorTienda(filtros)`,
  `agregarSaldoPorTienda(tiendaId, filtros)`, `listarSaldosTodasTiendas()` (para el maestro, R20).
- `lib/interfaces/services/IWalletTiendaService.ts` — `verMiSaldo(actor)`,
  `listarMisMovimientos(input, actor)` (adminTienda, acotado a `actor.usuarioId`),
  `listarSaldosTiendas(actor)` (maestro, R20). Guardias de rol.
- `lib/interfaces/services/IWalletTiendaFeedService.ts` —
  `construirMovimientosPorTienda(cierreId, tx)` → filas a insertar (crédito COD + débitos por
  tienda), usado DENTRO de la aprobación del cierre.
- `lib/repositories/WalletTiendaMovimientoRepository.ts`, `lib/services/WalletTiendaService.ts`,
  `lib/services/WalletTiendaFeedService.ts`.
- `lib/actions/wallet-tienda.ts` — Server Actions (`'use server'`): `verMiSaldoAction`,
  `listarMisMovimientosAction`, `listarSaldosTiendasAction` (resuelve actor vía
  `resolveActorFromSession`, valida rol, zod en el borde; espejo de `lib/actions/wallet.ts`).

### 2.2 Enganche en la aprobación del cierre (R5/R7 — MISMA tx que la 42)

`CierresAdminRepository.resolverCierre` ya orquesta `$transaction` y alimenta la 42. Se AÑADE la
alimentación del ledger por tienda EN EL MISMO bloque (todo-o-nada con la 42):

```
resolverCierre(input):
  $transaction(tx =>
    1. updateMany cierreDia -> aprobado (guardado por estado+alcance)   // sin cambios
    2. SI count===1 Y nuevoEstado==='aprobado':
         movs42  = walletFeedService.construirMovimientosDeIngreso(cierreId, tx)      // 42 (existente)
         walletMovimientoRepo.crearMovimientos(tx, movs42)                            // 42 (existente)
         movs43  = walletTiendaFeedService.construirMovimientosPorTienda(cierreId, tx) // 43 (NUEVO)
         walletTiendaMovimientoRepo.crearMovimientos(tx, movs43)                       // 43 (NUEVO, idempotente)
  )
```

- `CierresAdminRepository` recibe por constructor DOS dependencias nuevas
  (`IWalletTiendaMovimientoRepository`, `IWalletTiendaFeedService`), por inyección, igual que ya
  recibe las de la 42 (no se mete lógica en el repo: orquesta la tx). Se actualizan los `buildService`/
  factories que instancian `CierresAdminRepository` (una sola ubicación de wiring; el implementer la
  localiza — hoy en `lib/actions/cierres-admin.ts` u homólogo).
- Idempotencia (R6/R13): `createMany({ skipDuplicates: true })` sobre
  `wallet_tienda_movimiento_origen_uq`.
- Atomicidad (R7): mismo `$transaction`; si falla cualquier insert (42 o 43), rollback total.
- `CierreBodega` (R12): NO se toca; se documenta y se añade test negativo.

> **`WalletTiendaFeedService.construirMovimientosPorTienda(cierreId, tx)`** (R8/R9/R10/R11/R14/R28):
> 1. Lee TODAS las gestiones del cierre con `orden.{tiendaId, zonaId, montoCobrar, cobraComision,
>    zona.esCentral}`, `resultado` y `montoRecibido` (un solo `findMany`, espejo de
>    `WalletFeedService`).
> 2. Resuelve la tarifa vigente por zona (cache por `zonaId`, reutiliza `resolveTarifaPorZona`).
> 3. Por gestión: DÉBITOS = `derivarIngresoOrden(input, tarifa)` (los 6 conceptos de la 42),
>    mapeados a categorías de débito (`mapeo-concepto-tienda.ts`); CRÉDITO `cod_recaudado` =
>    `montoRecibido ?? 0` (Q2/R9).
> 4. **Interruptor Q3 (R28):** lee `walletTiendaConfig.TIENDA_DEBITA_FLETE_DEVOLUCION` (de
>    `lib/config/wallet-tienda.ts`, ÚNICO punto de lectura). SI es `false`, DESCARTA de la lista
>    de débitos las categorías `flete_devolucion` e `iva_flete_devolucion` (las que provienen de
>    `derivarIngresoOrden` en gestiones `devuelta`/`rechazada`) ANTES de agregar; el resto
>    (crédito COD, `flete`, `comision_cod`, IVAs de entrega) queda intacto. SI es `true`
>    (default), no filtra nada. El interruptor NO toca la 42 (su `WalletFeedService` sigue
>    registrando `ingreso_flete_devolucion`/`ingreso_iva_flete_devolucion`): con el flag en
>    `false`, ese ingreso lo ABSORBE Ordenex y no tiene contraparte en el ledger de la tienda.
> 5. Agrega por (tiendaId, categoria) con `Prisma.Decimal`; OMITE conceptos con total 0.00 (R11).
> 6. Devuelve `CrearMovimientoTiendaInput[]` con `origen_tipo=cierre_dia`, `origen_id=cierreId`,
>    `tienda_id`, montos STRING. NO persiste (lo hace el repo en la tx).
>
> **Reversión al alternar el flag (R29):** el filtro del paso 4 solo afecta lo que se genera
> HACIA ADELANTE. Como `flete_devolucion`/`iva_flete_devolucion` son SU PROPIA categoría en un
> libro append-only (R3), lo histórico NO se reescribe: para revertir un tramo ya registrado se
> emiten movimientos de AJUSTE compensatorio (`ajuste_credito`/`ajuste_debito`, `origen_tipo =
> manual`) que neutralizan esos débitos, sin `UPDATE`/`DELETE`. Alternar el flag NO requiere
> migración de esquema (las categorías ya existen en el enum).

### 2.3 Frontend (`app/` + `components/`)

- `app/(app)/mi-wallet/page.tsx` — Server Component role-aware (patrón `/wallet`): resuelve actor
  vía `resolveActorFromSession`; si no es `adminTienda` → `notFound()` (R19). Pre-fetch de
  `verMiSaldoAction` + `listarMisMovimientosAction` (acotados a `actor.usuarioId`), pasa datos
  STRING por props (R21).
- `app/(app)/mi-wallet/_components/MiWalletModule.tsx` — módulo cliente (saldo + desglose +
  filtros), recibe datos por props; sin fetch propio (datos sensibles).
- `app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx` — tarjeta de saldo a favor (positivo/
  negativo/cero, color + signo).
- `app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx` — tabla del desglose por
  cierre/concepto (shadcn/ui `Table`), etiquetas de concepto (crédito COD vs débitos).
- `app/(app)/mi-wallet/_components/MiWalletFiltros.tsx` — filtros fecha/cierre/concepto (R22).
- **Maestro (R20):** vista de saldos de todas las tiendas — recomendado como sección en `/wallet`
  (o ruta `/wallet/tiendas`, a confirmar A1): `app/(app)/wallet/tiendas/page.tsx` +
  `_components/SaldosTiendasTable.tsx`, role-aware `maestro`, pre-fetch de
  `listarSaldosTiendasAction`. (Ruta exacta pendiente F1.4-Q5/A1.)

## 3. Contratos I/O (frontera Server Action → cliente)

```ts
type WalletTiendaMovimientoDTO = {
  id: string;
  tiendaId: string;
  tipo: "credito" | "debito";
  categoria: string;                 // WalletTiendaMovimientoCategoria
  monto: string;                     // Decimal → STRING 2 dec (R4/R27)
  origenTipo: string;                // cierre_dia | pago_tienda | manual
  origenId: string | null;
  descripcion: string | null;
  fechaMovimiento: string;           // ISO
};

type SaldoTiendaDTO = {
  creditos: string;                  // STRING 2 dec
  debitos: string;                   // STRING 2 dec
  saldo: string;                     // STRING 2 dec (puede venir "-123.45")
  signo: "positivo" | "negativo" | "cero";
};

// Vista del maestro (R20): una fila por tienda.
type SaldoTiendaResumenDTO = {
  tiendaId: string;
  tiendaNombre: string;
  saldo: string;                     // STRING 2 dec + signo
  signo: "positivo" | "negativo" | "cero";
};
```

Todos los montos STRING; ningún `number` cruza la frontera (R27).

## 4. Fórmula (reutilizada de la 42 — NO se redefine)

Por cada gestión de un cierre aprobado, con `orden` (tiendaId, zona `Z`, montoCobrar,
cobraComision), `resultado`, `montoRecibido`, y `tarifa` vigente de `Z`:

```
// DÉBITOS: idénticos a la 42 (misma función), mapeados a categorías de débito de la 43.
conceptos = derivarIngresoOrden({ resultado, esCentral: Z.esCentral, montoCobrar, cobraComision }, tarifa)
  entregada           -> flete, iva_flete [+ comision_cod, iva_comision_cod si cobraComision]
  devuelta|rechazada  -> flete_devolucion, iva_flete_devolucion   // SOLO si el flag Q3 = true
  reprogramada        -> {}
  tarifa === null     -> {}   (débitos 0.00, R14)

// INTERRUPTOR Q3 (R28): si TIENDA_DEBITA_FLETE_DEVOLUCION === false,
//   se descartan flete_devolucion e iva_flete_devolucion del set de débitos de la tienda.

// CRÉDITO: propio de la 43 (Q2/R9).
cod_recaudado = montoRecibido ?? 0     // 0 en devuelta/rechazada/reprogramada
```

Agregación por (tiendaId, categoria) sumando sobre las gestiones del cierre; se OMITE todo
concepto con total 0.00 (R11). Redondeo money-safe (`toDecimalPlaces(2, ROUND_HALF_UP)`), salida
`toFixed(2)`.

**Invariante de cuadre (R15), CONDICIONAL al interruptor, verificable en test:**
- **Flag `true` (default):** para `entregada`,
  `cod_recaudado − (flete+comision+iva_flete+iva_comision) + ingreso_ordenex_42 = cod_recaudado`
  (porque `ingreso_ordenex_42 = flete+comision+iva_flete+iva_comision`). Para
  `devuelta`/`rechazada`, `0 − (flete_dev+iva_flete_dev) + (flete_dev+iva_flete_dev) = 0`. A
  nivel de cierre, `Σ_tiendas(débito_X) = ingreso_X` que la 42 registró.
- **Flag `false`:** `entregada` cuadra igual. Para `devuelta`/`rechazada` la tienda NO recibe
  esos débitos, así que `cod_recaudado − (saldo_tienda + ingreso_ordenex_42) = flete_dev +
  iva_flete_dev` (lo absorbe Ordenex). A nivel de cierre,
  `Σ_tiendas(flete_devolucion) = Σ_tiendas(iva_flete_devolucion) = 0.00`, mientras
  `ingreso_flete_devolucion`/`ingreso_iva_flete_devolucion` de la 42 permanecen intactos.

El test del invariante DEBE ejecutarse con el flag en AMBOS estados.

## 5. Migración

`db/migrations/<timestamp>_wallet_tienda_movimiento/`:
- `migration.sql` (UP): `CREATE TYPE` de los 2 enums nuevos (`wallet_tienda_movimiento_tipo`,
  `wallet_tienda_movimiento_categoria`); `CREATE TABLE wallet_tienda_movimiento`; índices
  (`(tienda_id, fecha_movimiento)`, `(tienda_id, categoria)`, `(origen_tipo, origen_id)`); índice
  único parcial de idempotencia; `ENABLE ROW LEVEL SECURITY` (sin policies); FKs `tienda_id` y
  `registrado_por` → `usuario`. NO altera tablas existentes (solo lados inversos de relación en
  `usuario`).
- `down.sql` (DOWN): `DROP TABLE wallet_tienda_movimiento;` `DROP TYPE` de los 2 enums. Reversible
  (R25).

Aditiva: no rompe lecturas existentes. En `db/schema.prisma`, `model Usuario` gana los lados
inversos `WalletTiendaMovimiento[]` (tienda y registrador); ninguna columna nueva en tablas
existentes.

## 6. Alternativas de diseño DESCARTADAS (obligatorio)

**Descartada (F1.4-Q1, principal): DERIVAR el saldo por tienda ON-THE-FLY** (sin tabla nueva,
sumando por tienda desde las gestiones de los cierres aprobados). Atractiva por evitar duplicación
("única fuente de verdad" en las gestiones). Se descarta porque:
1. **Divergencia money-critical con el snapshot de la 42.** La 42 CONGELA los conceptos al aprobar
   el cierre. Si una tarifa cambia después (soft-delete + nueva tarifa), `resolveTarifaPorZona`
   devuelve la ACTUAL; un derivado recomputaría con la tarifa nueva y DIVERGIRÍA del monto
   congelado por la 42, rompiendo el invariante de cuadre (R15). El ledger congela los mismos
   montos en el mismo instante que la 42.
2. **`wallet_movimiento` (42) no tiene `tienda_id`:** agrega por concepto POR CIERRE (across
   tiendas). No se puede reconstruir el saldo por tienda desde los datos ya congelados de la 42;
   habría que releer gestiones y re-derivar de todos modos, pero con la tarifa vigente actual (no
   la de la aprobación) → mismo problema de divergencia.
3. **Coste en ruta caliente:** cada carga de `/mi-wallet` recomputaría sobre todas las gestiones
   históricas de la tienda; el ledger da un `SUM(...)` indexado por `tienda_id`.
Queda como opción si el humano acepta que el saldo por tienda "siga" las tarifas actuales.

**Descartada (F1.4-Q6, secundaria): un único movimiento NETO por (tienda, cierre)** en vez de por
concepto. Menos filas, pero la tienda no vería el desglose (flete vs comisión vs IVAs vs
devolución) y se perdería el cuadre por concepto contra la 42 (R15). Se prefiere por-concepto,
alineado con la granularidad de la 42.

**Descartada (F1.4-Q4): incluir el flujo COMPLETO de liquidación (aprobaciones, comprobantes,
conciliación) en la 43.** Demasiado alcance para una feature money-critical; se entrega primero la
visibilidad correcta del saldo y el pago se añade como follow-up sobre un modelo ya probado
(categoría `pago_tienda` + `egreso_pago_tienda` de la 42 ya reservadas → sin cambio de esquema).

**Descartada (F1.4-Q3, reversibilidad): guardar el interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION`
como COLUMNA/tabla de settings en DB.** Permitiría togglear en runtime sin deploy, pero el repo
NO tiene patrón de settings en base de datos y sí un patrón consolidado de config por módulo
(`lib/config/*.ts`, sobreescribible por env). Una columna de DB añadiría esquema, migración y una
lectura extra en ruta caliente para una bandera que cambia rarísimo y es una decisión de negocio,
no de datos. Se elige la constante de config (una sola fuente de verdad, cero esquema, auditable
en git). Queda como opción si el negocio pidiese cambiarla sin deploy.
