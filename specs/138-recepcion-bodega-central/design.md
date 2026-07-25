# Feature 136 — Recepción en bodega central · design.md

> Depende de 135 (renombre de estados). Diseñado con los nombres **post-135**:
> `en_ruta_bodega_central` (origen) y `en_bodega_central` (destino).

## 1. Resumen de la decisión

Se añade un disparador de recepción física en la bodega central, análogo a
`RecepcionSateliteService` (feature 33) y `RecepcionOrigenService`, que cierra el callejón sin
salida de `en_ruta_bodega_central`. El actor autorizado es **maestro/admin** (`esAccesoTotal`), y
—a diferencia de la satélite— la recepción **no se acota por zona ni por tienda**: la bodega
central es global.

Capas (respetando `docs/architecture.md`):

```
app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx   ← UI (QR cámara + input guía)
  ↓ Server Action
lib/actions/recepcion-bodega-central.ts                            ← Controller (zod + actor + errores)
  ↓ interfaz
lib/services/RecepcionBodegaCentralService.ts                      ← Service (rol + guardias + idempotencia)
  ↓ interfaz IOrdenRepository
lib/repositories/OrdenRepository.ts (recibirEnBodegaCentral)       ← Repository (UPDATE guardado + append)
  ↓
Postgres (orden + orden_historial_estado)
```

No hay tabla nueva, ni listado nuevo, ni endpoint API público: la vista "por recibir" reutiliza la
tab `en_ruta_bodega_central` ya existente en `/ordenes` (`OrdenesTabs`).

## 2. Modelo de datos

### 2.1 Tablas

Ninguna tabla nueva. Se opera sobre `orden` (cambio de `estatus_id`) y `orden_historial_estado`
(append de la transición), ambas existentes y ya con RLS habilitada (solo service role; sin
policies nuevas). **No hay concern de RLS nuevo.**

### 2.2 Migración: nuevo valor de enum `orden_historial_origen_tipo`

Para R17 (trazabilidad) se añade el valor `recepcion_bodega_central` al enum
`orden_historial_origen_tipo`. Patrón EXACTO ya usado por
`20260717120000_orden_historial_origen_tipo_carga_api` (feature 88), que es **reversible**:

- `migration.sql` (UP):
  ```sql
  ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'recepcion_bodega_central';
  ```
  Va SOLA (sin usar el valor en la misma tx): Postgres no permite usar un valor de enum recién
  añadido en la misma transacción que lo añadió (error 55P04). El primer uso ocurre en tiempo de
  aplicación (`recibirEnBodegaCentral`), en transacciones posteriores.
- `down.sql` (DOWN): recrear el tipo SIN el valor (Postgres no soporta `DROP VALUE`), siguiendo el
  `down.sql` de la migración `carga_api`: `RENAME TO ..._old` → `CREATE TYPE` con la lista de
  valores previa a esta feature → `ALTER TABLE "orden_historial_estado" ALTER COLUMN "origen_tipo"
  TYPE ... USING (...::text::...)` → `DROP TYPE ..._old`. Precondición: ninguna fila de historial
  con `origen_tipo = 'recepcion_bodega_central'` (si la hubiera, el `USING` falla ruidosamente:
  comportamiento correcto). La lista de valores del CREATE TYPE debe copiarse del enum vigente
  ANTES de esta migración.

> Nota: la lista exacta de valores del `down.sql` debe tomarse del `db/schema.prisma` en el
> momento de implementar (el enum ha crecido; ver el bloque `OrdenHistorialOrigenTipo`). El
> `schema.prisma` también suma el nuevo valor en el enum de Prisma.

## 3. Backend

### 3.1 Repositorio — `OrdenRepository.recibirEnBodegaCentral`

Nuevo método, **espejo de `recibirEnOrigen`** pero SIN guardia de tienda/zona: la única guardia es
el estado de origen + no borrada. Concurrencia-segura (la guardia va en el propio `updateMany`).

```ts
async recibirEnBodegaCentral(
  ordenId: string,
  destinoEstatusId: string,
  historial: HistorialContexto,
): Promise<boolean>
```

Implementación (patrón `recibirEnOrigen`/`recibirEnSatelite`), dentro de un `$transaction`:

1. Pre-leer el origen con la MISMA guardia: `findFirst({ where: { id: ordenId, deletedAt: null,
   estatus: { value: 'en_ruta_bodega_central' } }, select: { estatusId } })`.
2. `updateMany({ where: { id: ordenId, deletedAt: null, estatus: { value:
   'en_ruta_bodega_central' } }, data: { estatusId: destinoEstatusId } })`.
3. SOLO si `result.count === 1 && actual !== null`: `appendCambioEstado(tx, [{ ordenId,
   estatusOrigenId: actual.estatusId, estatusDestinoId: destinoEstatusId, actorUsuarioId:
   historial.actorUsuarioId, origenTipo: 'recepcion_bodega_central' }])` (choke point feature 49:
   historial + outbox de webhook en la misma tx).
4. Devolver `result.count === 1`.

NO toca `mensajero_asignado_id` ni `num_guia` (R18).

`findByNumGuiaForTransicion(numGuia)` y `findEstatusIdByValue(value)` ya existen y se reutilizan sin
cambios. Se añaden ambos + `recibirEnBodegaCentral` al `Pick` de repo del service.

### 3.2 Interfaz repo — `IOrdenRepository`

Añadir la firma de `recibirEnBodegaCentral` a `lib/interfaces/repositories/IOrdenRepository.ts`
(reutiliza el tipo `HistorialContexto` existente). `ORIGEN_RECEPCION_BODEGA_CENTRAL` y el destino
son constantes locales del repo (como `ORIGEN_RECEPCION_SATELITE`).

### 3.3 Service — `RecepcionBodegaCentralService`

`lib/services/RecepcionBodegaCentralService.ts`, espejo de `RecepcionOrigenService` con estas
diferencias: (a) rol autorizado = `maestro` O `admin` (`esAccesoTotal`), (b) **sin** guardia de
tienda/zona.

Constantes:
```ts
const ORIGEN_RECEPCION = "en_ruta_bodega_central"; // post-135
const ESTADO_RECIBIDA  = "en_bodega_central";      // post-135
```

Método `recibirEnBodegaCentral(numGuia: number, actor: Actor): Promise<RecibirEnBodegaCentralServiceResult>`:

1. Rol: `if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }`  (R4).
2. `row = findByNumGuiaForTransicion(numGuia)`; si `!row || row.deletedAt !== null` →
   `no_encontrada` (R6).
3. Idempotencia: `if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" }` (R7).
4. Guardia de estado: `if (row.estatusValue !== ORIGEN_RECEPCION) return { status:
   "estado_invalido", estado: row.estatusValue }` (R8).
5. `destinoId = findEstatusIdByValue(ESTADO_RECIBIDA)`; si `null` → `validation_error` (catálogo
   incompleto / seed pendiente).
6. `ok = recibirEnBodegaCentral(row.id, destinoId, { actorUsuarioId: actor.usuarioId, origenTipo:
   "recepcion_bodega_central" })`.
7. Si `!ok` (perdió la carrera): re-leer; si ahora está `en_bodega_central` → `ya_recibida`
   (idempotente), si no → `conflict` (R9).
8. `return { status: "ok", ordenId: row.id, estado: ESTADO_RECIBIDA }`.

No conoce HTTP ni Prisma; testeable con dobles.

### 3.4 Contrato de resultado (dominio)

`lib/interfaces/services/IRecepcionBodegaCentralService.ts`:

```ts
export type RecibirEnBodegaCentralServiceResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_central" }   // R2
  | { status: "forbidden" }                                          // R4
  | { status: "estado_invalido"; estado: string }                   // R8
  | { status: "ya_recibida" }                                        // R7 (idempotente)
  | { status: "no_encontrada" }                                     // R6
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // catálogo incompleto
  | { status: "conflict" };                                         // R9

export interface IRecepcionBodegaCentralService {
  recibirEnBodegaCentral(numGuia: number, actor: Actor): Promise<RecibirEnBodegaCentralServiceResult>;
}
```

Nótese que **NO** hay `zona_ajena`/`tienda_ajena`/`sin_zona` (la satélite/origen sí): la recepción
central es global (R11).

### 3.5 Server Action (controller) — `lib/actions/recepcion-bodega-central.ts`

`'use server'`, espejo EXACTO de `recepcion-origen.ts`:

- `recibirEnBodegaCentralSchema = z.object({ numGuia: z.number().int().positive() })` (R10), en
  `lib/types/recepcion-bodega-central.ts`.
- `recibirEnBodegaCentralPorQr(input: unknown, deps = {})`: resuelve actor por sesión (sin sesión →
  `UnauthenticatedError`, R5), `parse` (ZodError → `VALIDATION_ERROR`, R10), delega al service.
  Todo bajo `withErrorHandler`; `toRecepcionBodegaCentralActionError` traduce solo
  `VALIDATION_ERROR`→`validation_error` y `UNAUTHORIZED`→`unauthenticated`, el resto son resultados
  de dominio del service.
- `deps` inyectables (`service`, `getActor`) para test.

Tipo de resultado expuesto `RecibirEnBodegaCentralResult` = el de dominio + `{ status:
"unauthenticated" }` (R5). Es una **mutación interna**: Server Action, no Route API (architecture:
"Mutación desde un componente propio → Server Action").

## 4. Frontend

### 4.1 Componente — `EscanerRecepcionBodegaCentral.tsx`

`app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx`, `"use client"`. Combina las dos
entradas de R12:

- **Cámara (R13):** reusa `QrScanner` (`components/shared/QrScanner`) + `extractNumGuiaFromScan`
  (`lib/utils/paquete-url`), idéntico a `EscanerRecepcionOrigen`.
- **Entrada manual (input de guía, R12b):** un `<Input type="number">` (shadcn/ui) + botón
  "Recibir": parsea a entero positivo y llama a la misma acción con `{ numGuia }`. Un valor no
  numérico/no positivo se rechaza en cliente con el mismo mensaje "Código inválido" (corte limpio,
  sin llamar a la acción), coherente con el `validation_error` del borde.

Ambos caminos funelan a `recibirEnBodegaCentralPorQr({ numGuia })` y traducen `RecibirEnBodegaCentralResult`
a un toast por resultado con `useToast` (R15), reutilizando `estatusLabel` para nombrar el estado en
`estado_invalido`. Guard `procesando` para no reentrar. Tras `ok`/`ya_recibida` invoca `onRecibida`
(R14). Mensajes (R15):

| status | toast |
| --- | --- |
| ok | success "Guía N recibida en bodega central." |
| ya_recibida | info "La guía N ya estaba recibida." |
| estado_invalido | error `No se puede recibir: la orden está en "<label>".` |
| no_encontrada | error "Orden no encontrada." |
| validation_error | error "Código inválido." |
| forbidden | error "No tienes permiso para recibir órdenes." |
| unauthenticated | error "Tu sesión expiró. Inicia sesión de nuevo." |
| conflict | error "La orden cambió de estado. Vuelve a intentar." |

### 4.2 Wiring — `OrdenesTabs.tsx` + `ordenes/page.tsx`

- `ordenes/page.tsx`: nueva gate `puedeRecibirBodegaCentral = rol ? esAccesoTotal(rol) : false`
  (maestro/admin, R16), pasada a `OrdenesTabs`.
- `OrdenesTabs.tsx`: nueva prop `puedeRecibirBodegaCentral?: boolean`. Cuando es `true`, el
  encabezado (que hoy monta `EscanerRecepcionOrigen`/carga masiva) monta también
  `EscanerRecepcionBodegaCentral` con `onRecibida={handleSuccess}` (que ya revalida las tablas por
  tab, R14). El control vive a nivel del contenedor (independiente de la tab activa), igual que
  `EscanerRecepcionOrigen`.

`adminTienda` NO recibe la gate (mantiene su `puedeEscanearQr` de recepción en origen). La tab
`en_ruta_bodega_central` (post-135) ya lista las órdenes "por recibir" para maestro/admin: no se
añade listado nuevo.

## 5. Integraciones

- **Historial + webhook (feature 49/99/104):** la transición pasa por `appendCambioEstado` (único
  choke point), que en la MISMA tx inserta el historial y encola el job de webhook (outbox). No se
  crean puntos de emisión nuevos. `origenTipo = 'recepcion_bodega_central'`.
- **135:** consume los nombres renombrados. Además, `BulkOrdenService.ESTATUS_INICIAL_API` pasa a
  `en_ruta_bodega_central` por 135 (la carga API sigue siendo el único productor del origen).

## 6. Alternativas descartadas

### 6.1 (Principal) Auto-recibir en la carga por API — descartada

**Alternativa:** cerrar el callejón haciendo que `BulkOrdenService.cargarViaApi` cree las órdenes
directamente en `en_bodega_central` (o transicione automáticamente sin intervención humana),
eliminando el paso de recepción.

**Por qué se descarta:** la recepción es un **control físico real** — alguien en la bodega central
confirma que el bulto llegó escaneando su etiqueta. Auto-recibir mentiría sobre la custodia física
(marcaría "en bodega" mercancía que sigue en tránsito) y borraría la traza de quién/cuándo la
recibió. Además rompe la simetría con el flujo satélite (feature 33), donde la recepción es
explícita. El estado `en_ruta_bodega_central` existe precisamente para representar "cargada por API,
aún no recibida físicamente".

### 6.2 Reusar un `origen_tipo` existente en vez de añadir `recepcion_bodega_central` — descartada

**Alternativa:** clasificar la transición con `ajuste_estado` (como hizo `RecepcionOrigenService`) o
con `recepcion_satelite`, evitando la migración de enum.

**Por qué se descarta:** `recepcion_satelite` es semánticamente falso (no es satélite) y
`ajuste_estado` es un cajón de sastre que impide distinguir en el historial/analítica las
recepciones centrales. La migración aditiva es barata y **reversible** (precedente `carga_api`,
§2.2), y CLAUDE.md §4 prioriza la trazabilidad. Se acepta la migración a cambio de un historial
legible (R17).

### 6.3 Página dedicada `/recepcion-bodega-central` (como la satélite) — descartada

**Alternativa:** una página propia con su layout, espejo de `/recepcion-satelite`.

**Por qué se descarta:** la satélite necesita página propia porque el `adminSatelite` no opera
`/ordenes`. Maestro/admin YA viven en `/ordenes` con la tab `en_ruta_bodega_central` como cola de
"por recibir"; añadir un control en el encabezado (como `EscanerRecepcionOrigen` para el
adminTienda) reutiliza toda la infraestructura de tabs/revalidación y evita una ruta y un listado
duplicados. (Queda como pregunta abierta #3 por si el humano prefiere página dedicada.)
