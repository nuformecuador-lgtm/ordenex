# Feature 138 — Guardia central de transiciones de `order_status` — design.md

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas + el inventario
> cerrado (apéndice A) + una alternativa descartada (§7).

## 1. Resumen de la decisión

- **Un módulo constante en código** (`lib/types/order-status-transiciones.ts`),
  co-locado con `order-status.ts` (la fuente de verdad del catálogo), que exporta:
  - `TRANSICIONES`: mapa `OrderStatusValue -> Destino[]` (cada destino con su metadato
    de familia/rol, R2).
  - `ESTADOS_CREACION`: `readonly OrderStatusValue[]` (destinos válidos de `null -> X`).
  - `ESTADOS_TERMINALES`: `readonly OrderStatusValue[]` = `["entregada", "en_tienda"]`
    (ver Q1).
  - `assertTransicionValida(origen: OrderStatusValue | null, destino: OrderStatusValue): void`
    — función PURA que lanza `TransicionIlegalError` si la arista no existe (R6/R12/R13).
- **El choke point** (`appendCambioEstado`) valida cada entrada del lote ANTES del
  `createMany`, resolviendo `id -> value` con un mapa de catálogo **cacheado por proceso**
  (inyectable, default real), sin round-trip de DB en el camino caliente (R13). Al fallar,
  el `throw` revierte la `$transaction` en curso -> todo-o-nada (R7).
- **Sin tabla nueva, sin migración, sin RLS.** El grafo es lógica de dominio inmutable,
  versionada con el código (ver §7 para la alternativa de tabla en DB, descartada).
- **Un test de conectividad** recorre el grafo (R14/R15/R16).

## 2. Modelo de datos

No hay cambios de esquema. El catálogo `order_status` (tabla existente, sembrada por
`seedOrderStatus` desde `ORDER_STATUS_SEED`) sigue siendo la única tabla implicada. La
guardia consume `value`s de ese catálogo; el mapa vive en código.

- **Migraciones:** ninguna.
- **RLS:** sin cambios (no hay tabla nueva).
- **Índices:** sin cambios.

## 3. Módulo `TRANSICIONES` (contrato)

```
// lib/types/order-status-transiciones.ts  (NUEVO, sin efectos secundarios)
type Familia = OrdenHistorialOrigenTipo;         // reutiliza el enum existente
interface Destino { to: OrderStatusValue; via: Familia; rol: string }
export const TRANSICIONES: Readonly<Record<OrderStatusValue, readonly Destino[]>>;
export const ESTADOS_CREACION: readonly OrderStatusValue[];
export const ESTADOS_TERMINALES: readonly OrderStatusValue[]; // entregada, en_tienda
export class TransicionIlegalError extends Error {}            // R12
export function assertTransicionValida(
  origen: OrderStatusValue | null,
  destino: OrderStatusValue,
): void;                                                       // R6/R10
```

- `assertTransicionValida(null, d)` valida `d ∈ ESTADOS_CREACION` (R10, ver Q5).
- `assertTransicionValida(o, d)` valida que exista un `Destino` con `to === d` en
  `TRANSICIONES[o]`; si no, lanza `TransicionIlegalError` con mensaje sin PII: sólo los
  dos `value` (R12). No usa `via`/`rol` para decidir (R2).
- **Exhaustividad estática (R5):** un chequeo tipo `satisfies Record<OrderStatusValue, ...>`
  rompe el build si el mapa no cubre un `value` del catálogo (patrón `ORDER_STATUS_SEED`
  / `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`).

## 4. Consumo desde `appendCambioEstado` (sin romper call-sites, R8)

Las `CambioEstadoEntrada` viajan con `estatusOrigenId` / `estatusDestinoId` (ids). El mapa
es por `value`. Para validar sin tocar los ~18 call-sites (que ya construyen ids):

- Se inyecta en `appendCambioEstado` un resolvedor `catalogo: (id) => OrderStatusValue`
  **cacheado por proceso** (el catálogo es inmutable tras el seed), con default real —
  mismo patrón que el `emitir: WebhookEmisor = emisorWebhookEstadoReal` ya existente.
- Antes del `createMany`, por cada entrada: resolver `origenValue` (o `null`) y
  `destinoValue` y llamar `assertTransicionValida`. Si alguna lanza, se propaga y la
  `$transaction` del call-site revierte (R7).
- Firma pública intacta salvo el nuevo parámetro opcional con default -> **cero cambios en
  los call-sites** (R8). El `tx: ChokePointTx` no cambia.

Flujo (pseudo):

```
export async function appendCambioEstado(tx, entradas, emitir = real, catalogo = realCat) {
  if (entradas.length === 0) return;
  for (const e of entradas) {
    const origen = e.estatusOrigenId === null ? null : catalogo.value(e.estatusOrigenId);
    assertTransicionValida(origen, catalogo.value(e.estatusDestinoId));   // R6/R7/R10
  }
  await tx.ordenHistorialEstado.createMany({ ... });                       // R11 (igual que hoy)
  await emitir(tx, entradas);                                             // R11 (igual que hoy)
}
```

- **Por qué en el choke point y no en cada service:** es el único punto por el que pasa
  TODA escritura de estado (feature 49), así que validar aquí cubre los ~18 call-sites de
  una vez y ninguno puede saltarse la guardia. Los `WHERE estatus_id = <origen>` de cada
  UPDATE siguen existiendo (defensa en profundidad anti-TOCTOU); la guardia añade la
  validación de **legalidad** que hoy nadie hace.

## 5. Escape hatch (`OrdenService.actualizar`) — decisión

`OrdenService.actualizar` permite a maestro/admin/adminTienda cambiar `estatusId` a
cualquier valor del catálogo (sólo valida `existsEstatus`), y persiste vía el choke point
con `origen_tipo = ajuste_estado`. Al pasar por `appendCambioEstado`, **quedará sujeto a la
guardia (R9)**: las aristas de ajuste administrativo legítimas se declaran explícitamente
en `TRANSICIONES` (familia `ajuste_estado`). Hoy el código usa `ajuste_estado` para dos
transiciones de flujo reales (devolver-a-tienda `rechazada -> devuelta_origen` y
recibir-en-origen `devuelta_origen -> en_tienda`), que ya quedan cubiertas. Un override
amplio `ANY -> ANY` NO se declara por defecto (debilitaría R14/R15); ver Q3.

## 6. Rutas / endpoints / integraciones

- **Rutas / endpoints:** ninguno nuevo. Es dominio puro consumido por el choke point.
- **Server Actions / route handlers:** sin cambios (los call-sites existentes no cambian
  su firma).
- **Integraciones externas:** ninguna. El webhook (feature 99) sigue igual (R11).

## 7. Alternativa descartada — tabla de transiciones en DB

**Opción B (descartada):** modelar el grafo como tabla `order_status_transition`
(`origen_id`, `destino_id`, `via`, `rol`) con RLS, migración up/down y seed, y validar con
una consulta (o cache) contra esa tabla.

**Por qué se descarta:**
1. **Camino caliente:** cada `appendCambioEstado` corre dentro de la tx de un call-site
   money-critical; añadir una lectura de tabla (o mantener su cache coherente) es coste y
   complejidad sin beneficio — el grafo es inmutable entre despliegues (viola el espíritu
   de R13).
2. **La legalidad es lógica de negocio, no dato de configuración:** cambiar una arista es
   cambiar el flujo de la aplicación (tests, services, UI), no un toggle de datos. Debe
   viajar en el PR, revisable en el diff y cubierto por el test de conectividad, no
   editable en caliente en producción sin pasar por CI.
3. **Trazabilidad y exhaustividad:** una constante `satisfies Record<OrderStatusValue,...>`
   rompe el build si el catálogo y el mapa divergen (R5). Una tabla no da esa garantía en
   tiempo de compilación; abre la puerta a drift entre enum y filas.
4. **Precedente del repo:** los catálogos de dominio ya viven como constantes-fuente
   (`ORDER_STATUS_SEED`, `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, `METODO_PAGO_SEED`) con seed
   idempotente derivado. El grafo sigue el mismo patrón.

**Segunda alternativa descartada (status quo):** dejar la validez dispersa en cada service
(sólo el `WHERE estatus_id`). Descartada porque no hay validación de legalidad central,
no hay forma de detectar callejones/cuellos de botella, y cada nuevo estado obliga a
auditar N services a mano — justamente la deuda que esta feature salda.

## 8. Test de conectividad (R14/R15/R16)

- Construir el grafo dirigido desde `TRANSICIONES` + un nodo virtual `START` con aristas a
  cada `ESTADOS_CREACION`.
- Para cada `value` de `ORDER_STATUS_SEED` (menos vestigiales declarados, Q2):
  - si NO es terminal: assert `inDegree >= 1` (contando `START`) y `outDegree >= 1`.
  - si es terminal: assert `inDegree >= 1` (un terminal inalcanzable también es un bug).
- Assert de cobertura: `keys(TRANSICIONES) ∪ destinos ∪ terminales ∪ creacion == SEED`
  salvo allowlist vestigial (R16).
- El fallo nombra el/los `value` ofensores (R15).

---

## Apéndice A — Inventario cerrado de transiciones (fuente: código actual)

> Leído de: `GuiaAsignacionService`, `AsignacionSateliteService`, `RecepcionSateliteService`,
> `MisAsignacionesService`, `CorteDiarioService`+`CierreDiaRepository`, `CierresAdminService`+
> `CierresAdminRepository`, `DevolucionSlaService`+`DevolucionSlaRepository`,
> `DevolucionOrigenService`, `RecepcionOrigenService`, `ReprogramacionTiendaService`,
> `RecuperacionBodegaService`, `LiberacionReprogramadaService`+`LiberacionReprogramadaRepository`,
> `CierreDiaService`(deshacer)+`CierreDiaRepository`, `OrdenRepository`(cancelarViaApi/carga),
> `OrdenService`(update/crear), `GestionOrdenRepository`, `RecuperacionBodegaRepository`,
> `lib/types/order-status.ts`, `lib/types/orden-historial.ts`, `lib/config/ordenes.ts`.
> Nomenclatura del catálogo ACTUAL. `en_tienda` = `recibido_origen` bajo el renombre 135 (Q1).

### A.1 — Creación (null -> X)

| Origen | Destino | Familia (`origen_tipo`) | Actor | Call-site |
| --- | --- | --- | --- | --- |
| null | `en_preparacion` (default) / `en_fulfillment` (tienda fulfillment) | `creacion_manual` | usuario autenticado | `OrdenService.crear` |
| null | `en_preparacion` / `en_fulfillment` | `carga_masiva` | usuario | `OrdenRepository.createManyOrdenes` |
| null | estado inicial del canal (con `num_guia`) | `carga_api` | apiKey/owner | `OrdenRepository.createManyOrdenesConGuia` |

`ESTADOS_CREACION` propuesto: `["en_preparacion", "en_fulfillment", <inicial carga_api>]`
(confirmar el estado inicial exacto de `carga_api`, ver Q5).

### A.2 — Transiciones de flujo (origen no nulo)

| # | Origen | Destino | Familia | Actor | Call-site |
| --- | --- | --- | --- | --- | --- |
| 1 | `en_fulfillment` | `en_espera_aceptacion` | `generacion_guia` | maestro/admin | `GuiaAsignacionService.generarGuia` (GAM+mensajero) |
| 2 | `en_fulfillment` | `en_bodega` | `generacion_guia` | maestro/admin | `generarGuia` (GAM sin mensajero) |
| 3 | `en_fulfillment` | `en_ruta_bodega_satelite` | `generacion_guia` | maestro/admin | `generarGuia` (no-GAM) |
| 4 | `en_preparacion` | `en_espera_aceptacion` | `generacion_guia` | maestro/admin | `generarGuia` (GAM+mensajero) |
| 5 | `en_preparacion` | `en_bodega` | `generacion_guia` | maestro/admin | `generarGuia` (GAM sin mensajero) |
| 6 | `en_preparacion` | `en_ruta_bodega_satelite` | `generacion_guia` | maestro/admin | `generarGuia` (no-GAM) |
| 7 | `en_bodega` | `en_ruta_bodega_satelite` | `ruteo_satelite` | maestro/admin | `GuiaAsignacionService.rutearABodegaSatelite` |
| 8 | `en_bodega` | `en_espera_aceptacion` | `asignacion_bodega` | maestro/admin | `GuiaAsignacionService.asignarDesdeBodega` |
| 9 | `en_bodega_satelite` | `en_espera_aceptacion` | `asignacion_satelite` | adminSatelite | `AsignacionSateliteService.asignar` |
| 10 | `en_ruta_bodega_satelite` | `en_bodega_satelite` | `recepcion_satelite` | adminSatelite | `RecepcionSateliteService.recibir`/`recibirLote` |
| 11 | `en_espera_aceptacion` | `en_reparto` | `recoleccion` | mensajero | `MisAsignacionesService.recogerAsignaciones` |
| 12 | `en_reparto` | `entregada` | `gestion` | mensajero | `MisAsignacionesService.gestionar` |
| 13 | `en_reparto` | `reprogramada` | `gestion` | mensajero | `gestionar` |
| 14 | `en_reparto` | `devuelta` | `gestion` | mensajero | `gestionar` |
| 15 | `en_reparto` | `rechazada` | `gestion` | mensajero | `gestionar` |
| 16 | `en_reparto` | `sin_gestionar` | `corte_sin_gestionar` | sistema/cron | `CorteDiarioService` -> `CierreDiaRepository.crearCierre` |
| 17 | `sin_gestionar` | `en_bodega` | `liberacion_sin_gestionar` | admin (aprobar) | `CierresAdminService.aprobarCierre` -> `resolverCierre` |
| 18 | `sin_gestionar` | `en_bodega_satelite` | `liberacion_sin_gestionar` | admin (aprobar) | `resolverCierre` |
| 19 | `devuelta` | `en_bodega` | `liberacion_devuelta_sla` | sistema/cron | `DevolucionSlaService` -> `liberarDevueltaSla` (reintento) |
| 20 | `devuelta` | `en_bodega_satelite` | `liberacion_devuelta_sla` | sistema/cron | `liberarDevueltaSla` (reintento) |
| 21 | `devuelta` | `rechazada` | `escalado_devuelta_sla` | sistema/cron | `escalarDevueltaSla` (escalado + gestión sintética) |
| 22 | `devuelta` | `reprogramada` | `reprogramacion_tienda` | adminTienda | `ReprogramacionTiendaService.reprogramar` |
| 23 | `devuelta` | `en_bodega` | `recuperacion_manual` | maestro/admin/adminSatelite | `RecuperacionBodegaService.recuperar` |
| 24 | `devuelta` | `en_bodega_satelite` | `recuperacion_manual` | adminSatelite | `recuperar` |
| 25 | `reprogramada` | `en_bodega` | `liberacion_reprogramada` | sistema/cron | `LiberacionReprogramadaService` -> `liberarOrden` |
| 26 | `reprogramada` | `en_bodega_satelite` | `liberacion_reprogramada` | sistema/cron | `liberarOrden` |
| 27 | `rechazada` | `devuelta_origen` | `ajuste_estado` | maestro/admin/adminSatelite | `DevolucionOrigenService.devolverATienda` |
| 28 | `devuelta_origen` | `en_tienda` (`recibido_origen`) | `ajuste_estado` | adminTienda | `RecepcionOrigenService.recibirEnOrigen` |
| 29 | `en_bodega` | `devuelta_origen` | `cancelacion_api` | apiKey (tienda) | `OrdenRepository.cancelarViaApi` |
| 30 | `en_ruta_bodega_principal` | `devuelta_origen` | `cancelacion_api` | apiKey (tienda) | `cancelarViaApi` |
| 31 | `entregada` | `en_reparto` | `deshacer_gestion` | mensajero | `CierreDiaService.deshacerGestion` |
| 32 | `reprogramada` | `en_reparto` | `deshacer_gestion` | mensajero | `deshacerGestion` |
| 33 | `rechazada` | `en_reparto` | `deshacer_gestion` | mensajero | `deshacerGestion` |
| 34 | `en_bodega` | `en_reparto` | `deshacer_gestion` | mensajero | `deshacerGestion` (defensa rama `devuelta`) |
| 35 | `en_bodega_satelite` | `en_reparto` | `deshacer_gestion` | mensajero | `deshacerGestion` (defensa rama `devuelta`) |
| 36 | `devuelta` | `en_reparto` | `deshacer_gestion` | mensajero | `deshacerGestion` (defensa filas legadas) |

**Escape hatch:** `OrdenService.actualizar` (`ajuste_estado`) puede hoy producir cualquier
`origen -> destino` del catálogo; en el mapa NO se declara `ANY -> ANY` (R9/Q3). Las
aristas #27 y #28 ya cubren los usos de `ajuste_estado` de flujo real.

### A.3 — Recuento y anomalías

- **36 transiciones de flujo distintas por call-site** (aristas 1–36); colapsadas a
  **34 aristas dirigidas `(origen, destino)` únicas** (las parejas #19/#23 y #20/#24
  comparten par pero difieren en familia). Más **3 familias de creación** (null -> X).
- **20 familias `origen_tipo`** involucradas (de las 21 del enum): las 17 de flujo + 3 de
  creación; `ajuste_estado` aparece en aristas de flujo (#27/#28) y en el escape hatch.
- **Anomalía detectada (Q2):** `en_ruta_bodega_principal` sólo aparece como ORIGEN
  (arista #30); no tiene ninguna entrada de flujo -> el test de R14/R15 lo marcaría como
  cuello de botella. Se documenta, no se resuelve aquí.
- **Terminales:** `entregada` y `en_tienda`(`recibido_origen`). `entregada` tiene salida
  vía deshacer (#31), lo cual es legítimo; el test exime a los terminales de necesitar
  salida (R14) pero exige que tengan entrada.
- **TODO(135/136/137):** los renombres (135), la recepción central (136) y la devolución
  de rechazadas (137) añaden/renombran aristas no verificables contra código hoy (Q4); se
  marcan en el mapa para completarse cuando esas features aterricen.
