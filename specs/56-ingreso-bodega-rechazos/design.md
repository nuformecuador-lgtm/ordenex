# Feature 56 — Ingreso de bodega por rechazos (`cobroRechazado`) — design.md

> Espejo técnico de la feature 39 (`lib/utils/pago-mensajero.ts` +
> `TarifaZonaMensajeroRepository` + snapshot en `CierreDiaService`/`CierreBodegaService` +
> exposición en `CierresAdminService`/`CierresBodegaAdminService`), pero con `cobroRechazado`
> para las gestiones `rechazada`, atribuido a la BODEGA. Reusa el resolver de tarifa y la
> resolución de destino existentes; NO los duplica. Todo el diseño está sujeto a F1.4
> (regla condicional Q1, resultados Q2, flag Q6).

## 1. Resolver reusado (sin duplicar)

`ITarifaZonaMensajeroRepository.resolvePagoTarifa(zonaId, vehiculoId)` ya devuelve
`PagoTarifa { cobroEntregado, cobroRechazado }` (ambos STRING escala 2, money-safe) y ya
implementa la resolución por (zona, vehículo) con fallback a la tarifa por defecto
(`vehiculo_id IS NULL`), determinista por el índice único `(zona_id, vehiculo_id)` NULLS
NOT DISTINCT. La 56 consume el MISMO método; el `cobroRechazado` ya viaja en el DTO. No se
crea ni se modifica el repositorio de tarifa.

### Nuevo util puro (espejo de `pagoPorResultado`)

`lib/utils/ingreso-bodega.ts`:

```ts
// F1.4-Q1/Q2: ingreso de la BODEGA por una gestión rechazada. Solo `rechazada` genera
// ingreso; el resto -> "0.00". Condición de aplicación (Q1, recomendada): cobroRechazado>0
// en la tarifa resuelta. tarifa===null (gap) -> "0.00" sin bloquear (R6). Money-safe:
// Prisma.Decimal, salida STRING escala 2 (R7). Función pura, testeable sin DB/red.
export function ingresoBodegaPorResultado(
  resultado: GestionResultado,
  tarifa: PagoTarifa | null,
): string {
  if (tarifa === null) return "0.00";                 // R6
  if (resultado !== "rechazada") return "0.00";       // R4 (Q2: solo rechazada)
  const cobro = new Prisma.Decimal(tarifa.cobroRechazado);
  // R5 (Q1-a): "aplica" = cobroRechazado configurado > 0. Si es 0 -> 0.00.
  return cobro.gt(0) ? cobro.toFixed(2) : "0.00";     // R3
}
```

> Si el humano decide otra semántica en Q1/Q2, este util es el ÚNICO punto de negocio a
> ajustar (mismo aislamiento que la 39). No se toca `pago-mensajero.ts`.

## 2. Modelo de datos — migración ADITIVA (patrón 39, R21)

Nueva migración `db/migrations/<timestamp>_ingreso_bodega_rechazos/` con `migration.sql`
(UP) + `down.sql` (DOWN obligatorio). 3 `ADD COLUMN`, sin tablas nuevas, sin tocar RLS
(las 3 tablas ya la tienen habilitada sin policies = solo service role) ni enums:

| Tabla | Columna nueva | Tipo | Nota |
| --- | --- | --- | --- |
| `gestion_orden` | `ingreso_bodega_rechazo` | `DECIMAL(12,2) NULL` | snapshot por gestión; NULL = gestión sin cerrar / pre-migración (R21). Espejo de `pago_mensajero`. |
| `cierre_dia` | `total_ingreso_bodega_rechazos` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | total snapshot del cierre del día; DEFAULT 0 -> cierres previos = 0.00 (R21). |
| `cierre_bodega` | `total_ingreso_bodega_rechazos` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | total agregado snapshot; DEFAULT 0 -> cierres previos = 0.00 (R21). |

`down.sql`: 3 `DROP COLUMN IF EXISTS` en orden inverso. Round-trip reversible.

### Prisma (`db/schema.prisma`)

- `GestionOrden`: `ingresoBodegaRechazo Decimal? @map("ingreso_bodega_rechazo") @db.Decimal(12,2)`
- `CierreDia`: `totalIngresoBodegaRechazos Decimal @default(0) @map("total_ingreso_bodega_rechazos") @db.Decimal(12,2)`
- `CierreBodega`: `totalIngresoBodegaRechazos Decimal @default(0) @map("total_ingreso_bodega_rechazos") @db.Decimal(12,2)`

## 3. Contratos I/O (DTOs) — extensiones aditivas

Todas las adiciones son campos STRING escala 2 (money-safe, R22), separados de los totales
existentes (R20). Espejo exacto de cómo la 39 añadió `pagoMensajero`/`totalPagoMensajero`.

- `CierreGestionPendienteRow` (`ICierreDiaRepository`): `+ ingresoBodegaRechazo: string | null`.
- `CierreDetalleGestion` (`ICierreDiaService`): `+ ingresoBodegaRechazo: string | null`.
  (Opcional F1.4-Q6: `+ tarifaFaltante: boolean`.)
- `CrearCierreInput`: `+ ingresoByGestionId: Record<string, string>` `+ totalIngresoBodegaRechazos: string`.
- `ListarCierreDiaServiceResult.ok`: `+ totalIngresoBodegaRechazos: string`.
- `CierrePasadoDTO`: `+ totalIngresoBodegaRechazos: string`.
- `CierreAdminResumen`/`...ResumenRow` (38): `+ totalIngresoBodegaRechazos: string`.
- `ListarConsolidacionServiceResult.ok` (40): `+ totalIngresoBodegaRechazosAgregado: string`.
- `CrearCierreBodegaInput`: `+ totalIngresoBodegaRechazos: string`.
- `CierreBodegaResumen`/`...ResumenRow` + `CierreBodegaDetalleCierre` (40): `+ totalIngresoBodegaRechazos: string`.

## 4. Integración en el flujo (dónde se engancha)

### 4.1 `CierreDiaService` (37 + reuso 39)
- `listarCierreDia`: ya resuelve la tarifa una vez (`resolveTarifaMensajero`). Añadir una
  derivación paralela `derivarIngresoBodega(gestiones, tarifa)` (espejo de `derivarPagos`)
  que produce `ingresoByGestionId` + `total`. Cada `CierreDetalleGestion` de `rechazada`
  expone `ingresoBodegaRechazo`; se añade `totalIngresoBodegaRechazos` al resultado (R9/R10).
  NO altera `computeTotales` ni el pago mensajero (R20).
- `solicitarCierre`: con la tarifa ya resuelta al snapshotear el pago (39), calcular en el
  MISMO punto `derivarIngresoBodega` y pasar `ingresoByGestionId` + `totalIngresoBodegaRechazos`
  a `crearCierre` (R11/R12). El destino (central/satélite) ya está resuelto ahí: el ingreso
  queda atribuido implícitamente a `destinoTipo`/`destinoZonaId` del cierre (R8).

### 4.2 `CierreDiaRepository.crearCierre` (39)
- En la MISMA `$transaction`: escribir `total_ingreso_bodega_rechazos` en el INSERT de
  `cierre_dia` y poblar `gestion_orden.ingreso_bodega_rechazo` agrupado por valor (mismo
  patrón `idsByPago`/`updateMany` que el pago mensajero) con guardia `cierreId = nuevo`
  (R13). También leer las 2 columnas en `findGestionesPendientes`/`findCierresByMensajero`.

### 4.3 `CierresAdminService` + `toDetalleDTO` (38)
- `toDetalleDTO` ya mapea `pagoMensajero` desde la fila; añadir `ingresoBodegaRechazo`
  (snapshot leído, R15). `toResumen` añade `totalIngresoBodegaRechazos` (R16). El repo de
  la 38 (`CierresAdminRepository`, reusa `WITH_DETALLE`/`toPendienteRow`) selecciona la
  nueva columna.

### 4.4 `CierreBodegaService` (40)
- Añadir `sumIngresoBodega(consolidables)` (espejo de `sumPagoMensajero`) y exponer
  `totalIngresoBodegaRechazosAgregado` en `listarConsolidacion` (R17). En
  `solicitarCierreBodega`, congelar el agregado en `crearCierreBodega` en la misma tx (R18).

### 4.5 `CierresBodegaAdminService` (40)
- El detalle agregado expone `totalIngresoBodegaRechazos` por cada `cierre_dia` y el
  agregado del `cierre_bodega` (R19), leídos del snapshot vía `toResumen`.

### 4.6 UI (pantallas existentes, sin pantallas nuevas — F1.4-Q7)
- `app/(app)/cierre-dia/*`, `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`
  y los módulos de bodega: añadir columna/label "Ingreso de bodega por rechazos" en la
  sección de rechazadas y una línea de total, junto a los totales existentes. Reuso del
  patrón de render del pago mensajero (`renderPagoMensajero`).

## 5. Alternativas descartadas (OBLIGATORIO)

1. **Derivar el ingreso on-the-fly en cada vista (sin snapshot ni migración).** Más simple,
   cero columnas. DESCARTADA: money-critical. `TarifaZonaMensajero` es editable (feature
   55); un cierre ya aprobado vería su ingreso mutar retroactivamente al editar la tarifa,
   rompiendo la conciliación con la wallet (42+). Se snapshotea, igual que 39/40.
2. **Tabla nueva `ingreso_bodega` (una fila por rechazo, FK a gestión/cierre).** Modelo más
   "contable". DESCARTADA por ahora: sobre-ingeniería para el alcance de la 56 (solo
   calcular/snapshotear/mostrar, sin asiento en caja). El asiento contable real es de la
   feature 42+. Replicar el patrón de 3 columnas de la 39 es consistente y suficiente;
   migrar a tabla-libro se hará en 42 si hace falta.
3. **Atribuir el ingreso a la zona de la ORDEN (`orden.zona_id`) en vez de la del
   mensajero.** DESCARTADA: rompería la consistencia con el destino del cierre (37/39, que
   usan `usuario.zona_id`) y con la premisa "la bodega responsable del mensajero recibe el
   ingreso". La orden y el mensajero comparten zona en el flujo normal, pero la fuente de
   verdad del cierre es la zona del mensajero.
4. **Duplicar un resolver propio para `cobroRechazado`.** DESCARTADA: el resolver de la 39
   ya devuelve `cobroRechazado`; duplicarlo violaría la instrucción de reuso y arriesgaría
   divergencia de la resolución con fallback.

## 6. Notas de riesgo

- **Money-critical:** todo con `Prisma.Decimal` y STRING escala 2. Prohibido `number`/
  `parseFloat` en cualquier suma o serialización (R7/R22). Los tests deben afirmar el tipo
  STRING de cada campo nuevo.
- **No romper la 39:** el ingreso de bodega es un carril paralelo. Verificar en tests de
  regresión que `pago_mensajero`, `total_pago_mensajero` y los `total_efectivo/simpe/...`
  NO cambian (R7b/R20). La derivación del ingreso se calcula con la MISMA `tarifa` ya
  resuelta para el pago; no añade queries extra en el caliente.
- **Regla condicional (F1.4-Q1):** el util aísla la condición en UNA función pura. Si el
  humano cambia Q1/Q2 tras la aprobación, el impacto es local (util + sus tests). Los
  requisitos marcados `[F1.4]` se re-redactan según la decisión ANTES de implementar.
- **Snapshot atómico:** el ingreso por gestión + el total del cierre deben escribirse en la
  MISMA `$transaction` que la 39 ya abre; no abrir una segunda transacción (evita cierres a
  medio snapshotear, R13).
- **Migración pre-existente:** cierres creados antes de la migración quedan con total
  `0.00` (DEFAULT) e `ingreso_bodega_rechazo` NULL; su lectura no rompe (R21). Test de
  round-trip up/down obligatorio.
- **Deuda 39 (Q6):** si se aprueba `tarifaFaltante`, derivarlo server-side donde ya se
  resuelve la tarifa (`null` -> true) y reemplazar la heurística de
  `renderPagoMensajero`/`PAGO_SIN_TARIFA` en `cierre-detalle-shared.tsx`; NO recalcular la
  tarifa una segunda vez.
