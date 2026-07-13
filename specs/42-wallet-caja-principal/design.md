# Feature 42 — Wallet: caja PRINCIPAL de Ordenex — design.md

> Decisiones técnicas. F1.4 APROBADA 2026-07-12 (ver `requirements.md`). Money-critical:
> `Prisma.Decimal` en todo cálculo, STRING `toFixed(2)` en la frontera, cero
> `parseFloat`/`Number(`. Patrón de capas Controller → Service → Repository con interfaces
> (`docs/architecture.md`). Baseline VERDE sobre `origin/dev` 84ddc3b.

## 1. Modelo de datos

### 1.1 Enums Postgres nativos (patrón `MetodoPagoValue`/`GestionResultado`)

```
enum WalletMovimientoTipo { ingreso  egreso  @@map("wallet_movimiento_tipo") }

enum WalletMovimientoCategoria {           // @@map("wallet_movimiento_categoria")
  // ingresos de Ordenex (42, implementados ahora)
  ingreso_flete                 // entregada: valorFlete[Gam]
  ingreso_flete_devolucion      // devuelta/rechazada: valorFleteDevuelto[Gam] (A1)
  ingreso_comision_cod          // entregada + orden.cobraComision (Q1)
  ingreso_iva_flete             // ivaFlete% sobre flete
  ingreso_iva_flete_devolucion  // ivaFlete% sobre flete de devolución (A1)
  ingreso_iva_comision_cod      // ivaComisionCod% sobre comisión (solo si hubo comisión)
  ingreso_ajuste            // manual (F1.4-Q6)
  // egresos (modelo RESERVADO para 43/44/45; la 42 NO los inserta)
  egreso_pago_tienda        // feature 43
  egreso_pago_mensajero     // feature 44
  egreso_gasto              // feature 45
  egreso_sueldo             // feature 45
  egreso_ajuste             // manual (F1.4-Q6)
}

enum WalletOrigenTipo { cierre_dia  gestion_orden  manual  pago_tienda  pago_mensajero  gasto  @@map("wallet_origen_tipo") }
```

Reservar valores de enum por adelantado sigue el patrón "reservar valores del enum" de la
feature 37 (`CierreEstado` reservó `aprobado`/`rechazado` para la 38). La 42 sólo EMITE
categorías `ingreso_*`; las `egreso_*` quedan disponibles para 43/44/45 sin nueva migración de
enum.

### 1.2 Tabla `wallet_movimiento` (modelo Prisma `WalletMovimiento`)

```
model WalletMovimiento {
  id            String                    @id @default(uuid())
  tipo          WalletMovimientoTipo
  categoria     WalletMovimientoCategoria
  monto         Decimal                   @db.Decimal(12, 2)   // > 0 (siempre positivo; el signo lo da `tipo`)
  origenTipo    WalletOrigenTipo          @map("origen_tipo")
  origenId      String?                   @map("origen_id")    // NULL solo para origen_tipo = manual
  descripcion   String?                                        // obligatoria en manual (validación en service/zod)
  registradoPor String?                   @map("registrado_por") // FK usuario (actor) en manual; NULL en automáticos
  fechaMovimiento DateTime                @default(now()) @map("fecha_movimiento")
  createdAt     DateTime                  @default(now()) @map("created_at")
  // SIN updatedAt / deletedAt: la fila es INMUTABLE (R3). No hay soft-delete.

  registrador   Usuario?                  @relation("WalletMovimientoRegistrador", fields: [registradoPor], references: [id])

  @@index([fechaMovimiento])                     // R24: listado del libro por fecha (desc)
  @@index([tipo, categoria])                     // R24: filtros
  @@index([origenTipo, origenId])                // R24: buscar movimientos de un origen
  @@map("wallet_movimiento")
}
```

Idempotencia (R6/R13/R24), va a mano en el SQL de la migración (Prisma no expresa índice
único PARCIAL):

```sql
CREATE UNIQUE INDEX wallet_movimiento_origen_categoria_uq
  ON wallet_movimiento (origen_tipo, origen_id, categoria)
  WHERE origen_id IS NOT NULL;
```

Con este índice, insertar dos veces `(cierre_dia, <cierreId>, ingreso_flete)` viola el
constraint → la segunda inserción es un no-op controlado (`ON CONFLICT DO NOTHING` o captura
del error de unicidad). NO se usa check-then-insert (evita TOCTOU, R6). Los movimientos
manuales (`origen_id NULL`) quedan FUERA del índice parcial (no se deduplican; son ajustes
libres).

### 1.3 RLS (R22)

`ALTER TABLE wallet_movimiento ENABLE ROW LEVEL SECURITY;` SIN políticas `anon`/`authenticated`
→ acceso solo vía service role (idéntico a `gestion_orden`/`cierre_dia`/`cierre_bodega`). El
enum y la tabla se crean en la misma migración aditiva con su `down.sql`.

### 1.4 Sin saldo almacenado (R16)

NO se crea ninguna columna/tabla de "saldo actual". El balance se DERIVA con una agregación:

```sql
SELECT
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos,
  COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'),  0) AS egresos
FROM wallet_movimiento
WHERE (<filtros opcionales: fecha/categoria/tipo>);
-- balance = ingresos - egresos  (se resta con Prisma.Decimal en el repo/service, STRING toFixed(2))
```

## 2. Rutas y capas

### 2.1 Backend (`lib/`)

- `lib/types/wallet.ts` — tipos de dominio + schemas zod (`WalletMovimientoDTO` con montos
  STRING; `WalletBalanceDTO { ingresos, egresos, balance, signo }`; `RegistrarMovimientoManualInput`;
  `ListarMovimientosInput { page, pageSize, tipo?, categoria?, desde?, hasta? }`).
- `lib/utils/ingreso-ordenex.ts` — función PURA
  `derivarIngresoOrden({ resultado, esCentral, montoCobrar, cobraComision }, tarifa)` que ramifica
  por `resultado` (§4): `entregada` → `{ flete, ivaFlete, comisionCod?, ivaComisionCod? }` (los
  dos últimos solo si `cobraComision`); `devuelta`/`rechazada` →
  `{ fleteDevolucion, ivaFleteDevolucion }`; `reprogramada` → vacío. Y
  `agregarIngresosPorConcepto(gestiones, tarifaPorZona)` → totales por concepto (STRING),
  omitiendo conceptos con total `0.00`. Toda la aritmética con `Prisma.Decimal`. Espejo
  estructural de `lib/utils/pago-mensajero.ts` + `lib/utils/cierre-totales.ts`. La gestión aporta
  su `resultado`; la orden aporta `zona.esCentral`, `montoCobrar` y `cobraComision` (R26).
- `lib/utils/wallet-balance.ts` — `derivarBalance(ingresos, egresos)` PURA (Decimal → STRING+signo).
- `lib/interfaces/repositories/IWalletMovimientoRepository.ts` — `crearMovimientos(tx, movs)`
  (idempotente, acepta cliente de transacción), `listar(filtros)`, `agregarBalance(filtros)`.
- `lib/interfaces/repositories/ITarifaVigentePorZonaRepository.ts` — `resolveTarifaPorZona(zonaId)`
  → tarifa vigente (no borrada) de la zona, montos/porcentajes STRING (NUEVO resolver; F1.4-Q1).
- `lib/interfaces/services/IWalletService.ts` — `listarMovimientos`, `verBalance`,
  `registrarMovimientoManual` (F1.4-Q6). Todos con `Actor` (rol).
- `lib/interfaces/services/IWalletFeedService.ts` — `construirMovimientosDeIngreso(cierreId, tx)`
  usado DENTRO de la aprobación del cierre; devuelve las filas a insertar (no las persiste solo,
  las pasa al repo dentro de la tx).
- `lib/repositories/WalletMovimientoRepository.ts`, `lib/repositories/TarifaVigentePorZonaRepository.ts`.
- `lib/services/WalletService.ts`, `lib/services/WalletFeedService.ts`.
- `lib/actions/wallet.ts` — Server Actions (`'use server'`): `listarMovimientosAction`,
  `verBalanceAction`, `registrarMovimientoManualAction` (valida rol vía `cookies()`; zod en el borde).

### 2.2 Enganche en la aprobación del cierre (R5/R7 — punto EXACTO)

El punto de transición a `aprobado` es `CierresAdminRepository.resolverCierre`
(`lib/repositories/CierresAdminRepository.ts`), hoy un `updateMany` de una sola sentencia. Se
envuelve en `prisma.$transaction`:

```
resolverCierre(input):
  $transaction(tx =>
    1. updateMany cierreDia SET estado=aprobado WHERE id, estado IN (solicitado,vencido), <alcance>
       → count 0 ⇒ conflict/fuera_de_alcance (comportamiento actual intacto)
    2. SI nuevoEstado === 'aprobado' Y count === 1:
         movs = walletFeedService.construirMovimientosDeIngreso(cierreId, tx)   // R8/R9/R10
         walletMovimientoRepo.crearMovimientos(tx, movs)  // INSERT ... ON CONFLICT DO NOTHING (R6/R13)
  )
```

- Idempotencia (R6): el `ON CONFLICT DO NOTHING` sobre `wallet_movimiento_origen_categoria_uq`
  hace que re-aprobar (o un `vencido`→`aprobado` que ya alimentó) no duplique (R12/R13).
- Atomicidad (R7): todo dentro de la misma `$transaction`; si el insert falla, la aprobación
  hace rollback. No queda cierre aprobado sin movimientos.
- Sólo `nuevoEstado === 'aprobado'` alimenta; `rechazado` no toca la wallet.
- `CierreBodega` (R11): `CierresBodegaAdminService`/`Repository` (feature 40) NO se modifican
  para alimentar; se documenta explícitamente que la bodega NO genera ingreso (fuente única =
  `CierreDia`). Se añade un test negativo (R11).

> Nota de acoplamiento: hoy `CierresAdminRepository` "no toca otras tablas". La 42 introduce
> esa dependencia deliberadamente y por inyección (el repo recibe `IWalletMovimientoRepository`
> + `IWalletFeedService` por constructor), para no meter lógica de negocio en el repo: el repo
> orquesta la tx, el service construye los movimientos.

### 2.3 Frontend (`app/` + `components/`)

- `app/(dashboard)/wallet/page.tsx` — Server Component: valida rol (`maestro`) vía `cookies()`,
  pre-fetch de `listarMovimientosAction` + `verBalanceAction`, pasa datos (STRING) por props
  (R21). Rol no autorizado → `notFound()`/redirect (R19).
- `components/private/WalletLedger.tsx` — tabla del libro (shadcn/ui `Table` + `DataTable`
  compartido si existe), recibe movimientos por props. Sin fetch propio (datos sensibles).
- `components/private/WalletBalanceCard.tsx` — tarjeta de balance (positivo/negativo, color).
- `components/private/WalletFiltros.tsx` — filtros tipo/categoría/fecha (R20).
- `components/private/RegistrarMovimientoManualDialog.tsx` — solo si F1.4-Q6 aprobado; usa la
  Server Action (mutación interna, no `fetch`).

## 3. Contratos I/O (frontera Server Action → cliente)

```ts
type WalletMovimientoDTO = {
  id: string;
  tipo: "ingreso" | "egreso";
  categoria: string;                 // WalletMovimientoCategoria
  monto: string;                     // Decimal → STRING 2 dec (R4/R25)
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento: string;           // ISO
};

type WalletBalanceDTO = {
  ingresos: string;                  // STRING 2 dec
  egresos: string;                   // STRING 2 dec
  balance: string;                   // STRING 2 dec (puede venir "-123.45")
  signo: "positivo" | "negativo" | "cero";
};
```

Todos los montos STRING; ningún `number` cruza la frontera (R25).

## 4. Fórmula del ingreso (R8/R9/R26 — F1.4 APROBADA)

Por cada gestión de un cierre aprobado, con `orden` (zona `Z`, `montoCobrar`, `cobraComision`),
`tarifa` vigente de `Z` y `resultado` de la gestión. Dos caminos según `resultado`:

**Camino A — `entregada`** (flete normal + comisión condicionada):
```
flete            = Z.esCentral ? tarifa.valorFleteGam : tarifa.valorFlete
ivaFlete         = round2( flete × tarifa.ivaFlete / 100 )
si orden.cobraComision === true:                       // ← lectura de la nueva columna (R26)
  comisionCod    = round2( montoCobrar × tarifa.comisionCod   / 100 )
  ivaComisionCod = round2( comisionCod × tarifa.ivaComisionCod / 100 )
si orden.cobraComision === false:
  comisionCod = ausente; ivaComisionCod = ausente       // no aportan a ningún concepto
```

**Camino B — `devuelta` | `rechazada`** (flete de DEVOLUCIÓN + su IVA, SIN comisión):
```
fleteDevolucion    = Z.esCentral ? tarifa.valorFleteDevueltoGam : tarifa.valorFleteDevuelto
ivaFleteDevolucion = round2( fleteDevolucion × tarifa.ivaFlete / 100 )   // mismo % ivaFlete (A1)
// sin comisión COD ni su IVA: no hubo recaudo
```

**Camino C — `reprogramada`** (u otro resultado en tránsito): NO aporta a ningún concepto.

Agregación por concepto (R10), sumando sobre todas las gestiones del cierre:
`ingreso_flete = Σ flete`, `ingreso_flete_devolucion = Σ fleteDevolucion`,
`ingreso_comision_cod = Σ comisionCod`, `ingreso_iva_flete = Σ ivaFlete`,
`ingreso_iva_flete_devolucion = Σ ivaFleteDevolucion`,
`ingreso_iva_comision_cod = Σ ivaComisionCod`. **No se emite movimiento para un concepto cuyo
total sea `0.00`** (p. ej. cierre sin devoluciones → sin `ingreso_flete_devolucion`; cierre sin
órdenes con comisión → sin `ingreso_comision_cod`/`ingreso_iva_comision_cod`).

Si `tarifa === null` (zona sin tarifa vigente), TODOS los conceptos de esa orden son `0.00` y NO
se bloquea (R9). Redondeo money-safe con `Prisma.Decimal.toDecimalPlaces(2)`; salida `toFixed(2)`.

## 5. Migración

`db/migrations/<timestamp>_wallet_movimiento/`:
- `migration.sql` (UP): `CREATE TYPE` de los 3 enums; `CREATE TABLE wallet_movimiento`;
  índices (`fecha_movimiento`, `(tipo,categoria)`, `(origen_tipo,origen_id)`); índice único
  parcial de idempotencia; `ENABLE ROW LEVEL SECURITY` (sin policies); FK `registrado_por` →
  `usuario`; **más la columna nueva en `orden` (R26):**
  ```sql
  -- R26: bandera por-orden de cobro de comisión COD. DEFAULT true = retro-compatible
  -- (las órdenes existentes quedan como "cobran comisión"; NOT NULL sin backfill manual).
  ALTER TABLE orden ADD COLUMN cobra_comision boolean NOT NULL DEFAULT true;
  ```
- `down.sql` (DOWN): `ALTER TABLE orden DROP COLUMN cobra_comision;` `DROP TABLE
  wallet_movimiento;` `DROP TYPE` de los 3 enums. Reversible (R23).

Aditiva: no rompe la lectura de datos existentes. `orden` gana una columna con default
(sin backfill destructivo). `usuario` gana solo el lado inverso de la relación
`WalletMovimiento.registrador` (sin columna nueva en `usuario`). En `db/schema.prisma`,
`model Orden` gana `cobraComision Boolean @default(true) @map("cobra_comision")`.

## 6. Alternativa de diseño DESCARTADA (obligatoria)

**Descartada: almacenar un saldo mutable (`wallet_saldo`) actualizado en cada movimiento
(patrón "tablero de saldos").** Sería más rápido de leer (una fila), pero:
1. **Contradice la decisión del humano** (2026-07-10: "libro de movimientos, NO tablero de
   saldos calculados").
2. **Riesgo de desincronización money-critical:** un saldo mutable puede divergir del libro
   ante fallos parciales, concurrencia o un movimiento que se inserta pero no actualiza el saldo
   (TOCTOU). Derivar el balance de la suma es siempre consistente por construcción.
3. **Complejidad de concurrencia:** mantener el saldo exigiría bloqueos/serialización en cada
   inserción (43/44/45 escribiendo en paralelo), o triggers, aumentando la superficie de error.
Se prefiere DERIVAR el balance con `SUM(...)` + índices (R16/R24). Si en el futuro el volumen lo
exige, se puede añadir una vista materializada o un snapshot de balance PERIÓDICO (nunca la
fuente de verdad), sin cambiar el libro.

**Descartada (secundaria): snapshotear los 4 conceptos en `gestion_orden` al SOLICITAR el
cierre** (paridad con 39/56). Más coherente con el patrón snapshot existente, pero MODIFICA la
feature 37 (`solicitarCierre`) — fuera del alcance de la 42 — y adelanta trabajo antes de que el
humano confirme la fórmula (F1.4-Q1). La 42 materializa el snapshot en el propio movimiento
inmutable al aprobar. Queda como refinamiento futuro si se prefiere la paridad total.

**Descartada (F1.4-Q1): modelar el "cobro de comisión" como config global/por-zona o derivarlo
de un campo existente** (p. ej. asumir comisión siempre que `montoCobrar > 0`). Se descartó
porque el humano precisó que es un dato NUEVO **por orden** (algunas órdenes NO cobran comisión
aunque tengan COD), lo que no se puede inferir de `montoCobrar` ni de la zona. Se prefiere una
columna booleana explícita `orden.cobraComision` (`cobra_comision`, `NOT NULL DEFAULT true`,
retro-compatible): la 42 la añade y la LEE; su captura editable por-orden (14/15/16/17) queda
como deuda de seguimiento (A5), sin bloquear la 42. Alternativa de default `false` descartada:
rompería la retro-compatibilidad (todas las órdenes existentes dejarían de cobrar comisión de
golpe). Alternativa de columna en `gestion_orden` descartada: el "cobro de comisión" es un
atributo de la ORDEN (comercial), no del acto de gestión.
