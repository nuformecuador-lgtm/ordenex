# Feature 39 — Pago al mensajero por zona en el cierre — design.md

## 0. Resumen de la decision

**Estrategia: SNAPSHOT** (money-critical), coherente con features 37/40. El pago al
mensajero se congela al SOLICITAR el cierre (por gestion + total) y se agrega/congela
al solicitar el cierre de bodega. La vista EN VIVO del mensajero (antes de cerrar)
DERIVA el pago para preview. Requiere una migracion ADITIVA de 3 columnas + un resolver
nuevo. Ver "Alternativas descartadas" (§7) para el porque de no derivar siempre.

**F1.4 (2026-07-12): SOLO `entregada` paga al mensajero.** El pago al mensajero =
`cobroEntregado` para `entregada` y `0.00` para `rechazada`/`reprogramada`/`devuelta`.
El `cobroRechazado` de la tarifa NO se paga al mensajero: es un INGRESO DE BODEGA que se
modela en la **feature 56** (`depends_on: 39`), FUERA DEL ALCANCE de este diseno. La 39
lee `cobroRechazado` de la tarifa unicamente para dejarlo intacto; no lo usa en ningun
calculo de pago al mensajero.

## 1. Modelo de datos y migracion

Migracion `db/migrations/20260712130000_pago_mensajero_cierre/` (timestamp posterior a
la ultima aplicada `20260712120000_cierre_bodega`). ADITIVA y reversible.

`migration.sql` (UP):

```sql
-- Pago al mensajero snapshoteado por gestion (NULL mientras la gestion no se cierra).
ALTER TABLE "gestion_orden"
  ADD COLUMN "pago_mensajero" DECIMAL(12,2);

-- Total snapshot a pagar al mensajero del cierre del dia (money-critical, patron 37).
ALTER TABLE "cierre_dia"
  ADD COLUMN "total_pago_mensajero" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Total agregado snapshot a pagar a mensajeros del cierre de bodega (patron 40).
ALTER TABLE "cierre_bodega"
  ADD COLUMN "total_pago_mensajero" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

`down.sql` (DOWN, revierte exactamente):

```sql
ALTER TABLE "cierre_bodega" DROP COLUMN "total_pago_mensajero";
ALTER TABLE "cierre_dia" DROP COLUMN "total_pago_mensajero";
ALTER TABLE "gestion_orden" DROP COLUMN "pago_mensajero";
```

Notas:
- `gestion_orden.pago_mensajero` es NULLABLE: `NULL` = gestion aun no cerrada (se
  puebla al solicitar el cierre). Coherente con `gestion_orden.cierre_id` nullable.
- Los dos totales usan `DEFAULT 0` -> los cierres ya existentes quedan en `0.00` (R22).
- Sin cambios de RLS: son columnas sobre tablas ya existentes con RLS habilitada sin
  policies (solo service role). No hay tablas nuevas.
- Cambios de schema.prisma (declarativos, sin migracion adicional):
  - `model GestionOrden`: `pagoMensajero Decimal? @map("pago_mensajero") @db.Decimal(12,2)`
  - `model CierreDia`: `totalPagoMensajero Decimal @default(0) @map("total_pago_mensajero") @db.Decimal(12,2)`
  - `model CierreBodega`: `totalPagoMensajero Decimal @default(0) @map("total_pago_mensajero") @db.Decimal(12,2)`

## 2. El resolver de tarifa (pieza nueva central)

### 2.1 Repositorio: `ITarifaZonaMensajeroRepository` (nuevo)

`lib/interfaces/repositories/ITarifaZonaMensajeroRepository.ts`

```ts
export interface PagoTarifa {
  cobroEntregado: string; // Decimal -> string 2 dec (money-safe). UNICO campo que la 39 paga.
  cobroRechazado: string; // Se resuelve/transporta pero la 39 NO lo paga al mensajero
                          // (ingreso de bodega -> feature 56). Presente para no re-consultar.
}

export interface ITarifaZonaMensajeroRepository {
  /**
   * Resuelve la tarifa de pago de una zona segun el vehiculo del mensajero:
   * 1) intenta (zonaId, vehiculoId) exacto;
   * 2) si no hay (o vehiculoId es null), cae a la tarifa por defecto (vehiculoId IS NULL);
   * 3) null si la zona no tiene ninguna tarifa.
   * El indice unico (zona_id, vehiculo_id) NULLS NOT DISTINCT garantiza determinismo.
   */
  resolvePagoTarifa(zonaId: string, vehiculoId: string | null): Promise<PagoTarifa | null>;
}
```

Implementacion `lib/repositories/TarifaZonaMensajeroRepository.ts`: una o dos queries
Prisma (`findUnique` por `zonaId_vehiculoId` cuando hay vehiculo -> si null, `findFirst`
por `zonaId, vehiculoId: null`). Devuelve Decimals serializados con `toFixed(2)`.

### 2.2 Util puro: mapeo resultado -> monto

`lib/utils/pago-mensajero.ts`

```ts
import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

/**
 * R5-R8/R7b (F1.4): pago al MENSAJERO por una gestion. Solo `entregada` paga
 * (`cobroEntregado`); cualquier otro resultado -> "0.00". tarifa=null -> "0.00" (gap
 * seguro). El `cobroRechazado` NUNCA se paga al mensajero (ingreso de bodega -> feat 56).
 */
export function pagoPorResultado(
  resultado: GestionResultado,
  tarifa: PagoTarifa | null,
): string {
  if (tarifa === null) return "0.00";                 // R8
  if (resultado === "entregada") {                    // R5
    return new Prisma.Decimal(tarifa.cobroEntregado).toFixed(2);
  }
  return "0.00";                                       // R6/R7/R7b: rechazada/reprogramada/devuelta
}
```

Puro, testeable sin DB/red. Money-safe (Prisma.Decimal, string 2 dec). Nota: `tarifa`
sigue exponiendo `cobroRechazado`, pero esta funcion NO lo lee (F1.4).

### 2.3 Resolver del vehiculo del mensajero

Se necesita `usuario.vehiculo_id` ademas de `usuario.zona_id`. Extender
`IOrdenRepository` (espejo del existente `findUsuarioZonaId`) con:

```ts
/** Feature 39: vehiculo del mensajero (null si no tiene). Espejo de findUsuarioZonaId. */
findUsuarioVehiculoId(usuarioId: string): Promise<string | null>;
```

Alternativa considerada: un unico `findMensajeroZonaVehiculo(usuarioId)` que devuelva
`{ zonaId, vehiculoId }` para ahorrar una query. Aceptable; se deja a criterio de impl
(preferible combinar para evitar 2 round-trips). En cualquier caso NO se toca el tipo
`Actor` (la resolucion es server-side, patron 37).

## 3. Integracion en feature 37 (cierre del mensajero)

### 3.1 Vista en vivo (`listarCierreDia`, DERIVADO)

- `CierreDiaService.listarCierreDia`:
  1. Resuelve `zonaId = ordenRepo.findUsuarioZonaId(actor)` y
     `vehiculoId = ordenRepo.findUsuarioVehiculoId(actor)`.
  2. `tarifa = tarifaZonaRepo.resolvePagoTarifa(zonaId, vehiculoId)` (una vez).
  3. Por cada gestion: `pagoMensajero = pagoPorResultado(g.resultado, tarifa)`.
  4. `totalPagoMensajero = suma(Prisma.Decimal)` de los pagos por gestion.
- El service inyecta el nuevo repo (`ITarifaZonaMensajeroRepository`) y el metodo
  `findUsuarioVehiculoId` por constructor (Pick, patron actual).
- Si `zonaId` es null: pago 0 en todas (no bloquea la vista; el gate de cierre por
  zona ya lo maneja la 37).

### 3.2 DTOs (feature 37)

- `CierreDetalleGestion` (`ICierreDiaService.ts`): agregar
  `pagoMensajero: string | null` (`null` no aplica aqui: en vivo siempre string; se
  deja el tipo compatible con la lectura snapshot del admin).
- `ListarCierreDiaServiceResult` (rama ok): agregar `totalPagoMensajero: string`.
- `CierrePasadoDTO`: agregar `totalPagoMensajero: string` (leido del snapshot
  `cierre_dia.total_pago_mensajero`).
- `CierreTotales` NO se toca (pago es concepto aparte, R21).

### 3.3 Snapshot al solicitar (`solicitarCierre`, CONGELADO)

- Tras validar precondiciones y resolver `zonaId`, resolver `vehiculoId` + `tarifa`.
- Calcular `pagoByGestionId: Record<gestionId, string>` con `pagoPorResultado` y
  `totalPagoMensajero` (suma Decimal).
- Pasar ambos a `crearCierre` (input extendido).

### 3.4 Repositorio (`CierreDiaRepository.crearCierre`, transaccional R14)

`CrearCierreInput` (`ICierreDiaRepository.ts`) agrega:
```ts
pagoByGestionId: Record<string, string>; // gestionId -> pago STRING
totalPagoMensajero: string;
```
Dentro de la `$transaction` existente:
1. `create cierreDia` incluyendo `totalPagoMensajero: new Prisma.Decimal(...)`.
2. `updateMany gestionOrden` (ya setea `cierreId`).
3. Poblar `pago_mensajero` por gestion. Opciones (equivalentes, todo dentro de la tx):
   - AGRUPADO por resultado (recomendado, O(1) queries): dado que solo `entregada` paga
     (F1.4) y la tarifa es fija por cierre, bastan 2 `updateMany`:
     `WHERE mensajeroId, cierreId=nuevo, resultado='entregada'      SET pago = cobroEntregado`
     `... resultado IN ('rechazada','reprogramada','devuelta')      SET pago = 0.00`
     (usa la tarifa ya resuelta; si tarifa=null, todo 0.00). NO se usa `cobroRechazado`.
   - Alternativa: `pagoByGestionId` fila-a-fila (N updates) — mas simple de razonar,
     mas queries. Preferir el agrupado.
- El `WHERE` mantiene la guardia de propiedad + no-cerradas (concurrencia-segura).

### 3.5 Lectura del historico (`findCierresByMensajero`)

- Agregar `totalPagoMensajero: r.totalPagoMensajero.toFixed(2)` al select/map.

## 4. Integracion en feature 38 (admin de cierres)

- `CierresAdminRepository` reusa `WITH_DETALLE` de `CierreDiaRepository`: agregar
  `pagoMensajero: true` al `select`, y `toPendienteRow` mapea
  `pagoMensajero: decimalToString(row.pagoMensajero)` (snapshot; puede ser null en
  cierres pre-migracion -> se muestra `0.00` o `null` segun UI).
- `CierreAdminResumen` (`ICierresAdminService.ts`): agregar
  `totalPagoMensajero: string` (leido de `cierre_dia.total_pago_mensajero`).
- `verCierreDetalle`: el pago por orden viaja ya en `CierreDetalleGestion.pagoMensajero`
  (snapshot). Sin recomputo (R16).

## 5. Integracion en feature 40 (cierre de bodega)

- `CierreBodegaResumenLite` y `CierreBodegaResumen` (`ICierreBodegaService.ts`):
  agregar `totalPagoMensajero: string`.
- `CierreBodegaService.listarConsolidacion`: `findCierresDiaConsolidables` ya trae
  `totales`; agregar `totalPagoMensajero` por cierre_dia y sumar el agregado
  (`sumPagoMensajero` con Prisma.Decimal, patron `sumTotales`).
- `solicitarCierreBodega`: snapshotear el agregado en `cierre_bodega.total_pago_mensajero`
  dentro de la tx de `crearCierreBodega` (R19). Extender `CrearCierreBodegaInput` con
  `totalPagoMensajero: string`.
- `CierreBodegaDetalleCierre`: agregar `totalPagoMensajero: string` por cierre_dia.
  El maestro (`ICierresBodegaAdminService`) lo expone en el detalle (R20) + el agregado
  en `CierreBodegaResumen`.
- Esto LLENA el hueco que la 40 dejo a proposito (`ICierreBodegaService.ts` linea 14:
  "Ningun DTO expone el pago al mensajero (R14, es la feature 39)").

## 6. Contratos I/O (resumen de deltas)

| Simbolo | Delta |
| --- | --- |
| `CierreGestionPendienteRow` (repo 37) | `+ pagoMensajero: string \| null` |
| `WITH_DETALLE` select (repo 37) | `+ pagoMensajero: true` |
| `CierreDetalleGestion` (svc 37) | `+ pagoMensajero: string \| null` |
| `ListarCierreDiaServiceResult.ok` | `+ totalPagoMensajero: string` |
| `CierrePasadoDTO` | `+ totalPagoMensajero: string` |
| `CrearCierreInput` | `+ pagoByGestionId`, `+ totalPagoMensajero` |
| `CierreAdminResumen` (svc 38) | `+ totalPagoMensajero: string` |
| `CierreBodegaResumenLite` / `CierreBodegaResumen` (svc 40) | `+ totalPagoMensajero: string` |
| `CierreBodegaDetalleCierre` (svc 40) | `+ totalPagoMensajero: string` |
| `CrearCierreBodegaInput` (repo 40) | `+ totalPagoMensajero: string` |
| `ITarifaZonaMensajeroRepository` | NUEVO (`resolvePagoTarifa`) |
| `IOrdenRepository` | `+ findUsuarioVehiculoId` (o `findMensajeroZonaVehiculo`) |
| `lib/utils/pago-mensajero.ts` | NUEVO (`pagoPorResultado`) |

Todos los montos cruzan como STRING 2 decimales (R9/R23). El pago NUNCA se mezcla con
`CierreTotales` (R21).

## 7. Alternativas descartadas

**A1 — Derivar el pago on-the-fly siempre (sin migracion, sin snapshot).**
Mas simple: no requiere columnas nuevas; el pago se calcula al mostrar cada cierre
leyendo `tarifa_zona_mensajero` vigente. DESCARTADA (money-critical): `tarifa_zona_
mensajero` es editable desde configuracion (feature 55). Si el maestro edita una tarifa,
el monto de un cierre YA APROBADO cambiaria retroactivamente, rompiendo la consistencia
contable, el historico y la conciliacion con la feature 44 (cuentas por pagar dependen
de un numero estable). El resto del dominio de cierres (37/40) ya congela dinero por la
misma razon; derivar seria incoherente.

**A2 — Snapshot solo del total en `cierre_dia` (sin columna por gestion).**
Menos migracion. DESCARTADA: el detalle por orden (feature 38 y 40 muestran el pago por
orden) tendria que RE-derivarse desde la tarifa vigente, reintroduciendo la mutabilidad
de A1 justo donde importa el detalle auditado.

**A3 — Guardar el pago en `zona` (como sugeria la descripcion vieja).**
DESCARTADA: contradice el modelo real; `zona.pagoEntrega/pagoRechazo` fueron ELIMINADAS
por el refactor #40. La fuente de verdad es `tarifa_zona_mensajero`.

**A4 — Bloquear el cierre si falta la tarifa de la zona.**
DESCARTADA: impediria al mensajero cerrar su dia por una omision de configuracion del
maestro (la tabla no esta sembrada). Se opta por pago `0.00` no bloqueante (R8), con
posible aviso en la vista admin (Q5, abierto).

## 8. Notas de riesgo

- **Money-critical Decimal**: toda suma con `Prisma.Decimal`, salida `toFixed(2)`.
  Prohibido `number`/`parseFloat` (patron ya vigente en 37/40).
- **Gap de datos**: `tarifa_zona_mensajero` puede estar VACIA en runtime (no hay seed;
  se captura via `ZonaForm`). El fallback R8 (0.00) evita romper cierres; conviene
  evidenciar los pagos que resolvieron a 0 por falta de tarifa (aviso admin, Q5).
- **Cierres previos**: los `cierre_dia`/`cierre_bodega` creados antes de la migracion
  quedan con total `0.00` y sus gestiones con `pago_mensajero` NULL (historicos; sin
  reproceso). Documentado en R22.
- **Concurrencia**: el snapshot se puebla dentro de la `$transaction` existente de
  `crearCierre`/`crearCierreBodega`; se preserva el `WHERE` guardado (propiedad + no
  cerradas / indice unico parcial). Sin nuevas ventanas TOCTOU.
- **Reuso**: el detalle del admin (38) y bodega (40) reusan `WITH_DETALLE`/mappers de
  37; agregar `pagoMensajero` en un solo lugar propaga a los tres modulos.
