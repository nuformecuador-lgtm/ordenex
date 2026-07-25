# Feature 140 — Guardia central de transiciones de `order_status` — design.md

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas + el inventario
> cerrado (apéndice A) + una alternativa descartada (§7).
> **Reconciliado 2026-07-25** contra `dev` con 137/138/139 ya mergeadas: IDs renumerados
> y apéndice A re-verificado leyendo el código (no heredado del borrador).

## 1. Resumen de la decisión

- **Un módulo constante en código** (`lib/types/order-status-transiciones.ts`),
  co-locado con `order-status.ts` (la fuente de verdad del catálogo), que exporta:
  - `TRANSICIONES`: mapa `OrderStatusValue -> Destino[]` (cada destino con su metadato
    de familia/rol, R2).
  - `ESTADOS_CREACION`: `readonly OrderStatusValue[]` =
    `["en_preparacion", "en_fulfillment", "en_ruta_bodega_central"]` (Q5 resuelta por el
    gate; destinos válidos de `null -> X`).
  - `ESTADOS_TERMINALES`: `readonly OrderStatusValue[]` = `["entregada", "devuelta_a_tienda"]`
    (Q1 resuelta por el gate; 137 renombró `recibido_origen -> devuelta_a_tienda`).
  - `assertTransicionValida(origen: OrderStatusValue | null, destino: OrderStatusValue): void`
    — función PURA que lanza `TransicionIlegalError` si la arista no existe (R6/R12/R13).
- **El choke point** (`appendCambioEstado`) valida cada entrada del lote ANTES del
  `createMany`, resolviendo `id -> value` con un mapa de catálogo **cacheado por proceso**
  (inyectable, default real), sin round-trip de DB en el camino caliente (R13). Al fallar,
  el `throw` revierte la `$transaction` en curso -> todo-o-nada (R7).
- **ACTIVACIÓN ESTRICTA desde el día 1 (decisión del gate, Q7).** La guardia lanza en
  producción desde el primer despliegue: **no se implementa** modo shadow, modo solo-log
  ni feature flag de apagado. No hay variable de entorno, ni `ordenesConfig.*`, ni
  parámetro de bypass. Riesgo asumido: un hueco en el inventario (apéndice A) tumba ese
  flujo en producción — no degrada en silencio, falla ruidosamente y revierte la tx. Lo
  que cubre ese riesgo es el test **data-driven de no-regresión sobre el inventario
  COMPLETO** (T3.4) más la cobertura exacta del catálogo del test de conectividad (T3.1).
  Corolario para el implementer: **no** añadir un flag "por si acaso"; sería exactamente
  la puerta que el gate decidió no abrir.
- **Sin tabla nueva, sin migración, sin RLS.** El grafo es lógica de dominio inmutable,
  versionada con el código (ver §7 para la alternativa de tabla en DB, descartada).
- **Un test de conectividad** recorre el grafo (R14/R15/R16).

## 2. Modelo de datos

No hay cambios de esquema. El catálogo `order_status` (tabla existente, sembrada por
`seedOrderStatus` desde `ORDER_STATUS_SEED`, hoy **18 values**) sigue siendo la única
tabla implicada. La guardia consume `value`s de ese catálogo; el mapa vive en código.

- **Migraciones:** ninguna.
- **RLS:** sin cambios (no hay tabla nueva).
- **Índices:** sin cambios.

## 3. Módulo `TRANSICIONES` (contrato)

```
// lib/types/order-status-transiciones.ts  (NUEVO, sin efectos secundarios)
type Familia = OrdenHistorialOrigenTipo;         // reutiliza el enum existente (22 valores)
interface Destino { to: OrderStatusValue; via: Familia; rol: string }
export const TRANSICIONES: Readonly<Record<OrderStatusValue, readonly Destino[]>>;
export const ESTADOS_CREACION: readonly OrderStatusValue[];    // 3 valores (Q5)
export const ESTADOS_TERMINALES: readonly OrderStatusValue[];  // entregada, devuelta_a_tienda
export class TransicionIlegalError extends Error {}            // R12
export function assertTransicionValida(
  origen: OrderStatusValue | null,
  destino: OrderStatusValue,
): void;                                                       // R6/R10
```

- `assertTransicionValida(null, d)` valida `d ∈ ESTADOS_CREACION` y lanza si no (R10,
  Q5 RESUELTA: la creación SÍ se valida).
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

## 5. Escape hatch (`OrdenService.actualizar`) — decisión CERRADA (Q3)

`OrdenService.actualizar` permite hoy a cualquier rol conocido (maestro/admin/adminTienda/
adminSatelite; y `mensajero` limitado a tocar sólo `estatusId`) cambiar `estatus_id` a
cualquier valor del catálogo — sólo valida `existsEstatus` — y persiste vía el choke point
con `origen_tipo = ajuste_estado`. Al pasar por `appendCambioEstado`, **queda sujeto a la
guardia (R9)**.

Decisión del humano: **todo pasa por la guardia**. NO se declara ningún override
`ANY -> ANY`, ni siquiera reservado para maestro/admin. Las aristas de ajuste
administrativo legítimas se declaran explícitamente en `TRANSICIONES` (familia
`ajuste_estado`). Tras la 139, el código usa `ajuste_estado` para **tres** transiciones de
flujo reales, todas ya declaradas en el apéndice A:

| # | Arista | Call-site |
| --- | --- | --- |
| #28 | `devolviendo_a_tienda -> devuelta_a_tienda` | `RecepcionOrigenService.recibirEnOrigen` |
| #40 | `por_devolver -> devolviendo_a_bodega_central` | `EnvioDevolucionCentralService.enviarACentral` |
| #42 | `por_devolver_a_tienda -> devolviendo_a_tienda` | `DevolucionOrigenService.devolverATienda` |

(La vieja arista `rechazada -> devolviendo_a_tienda` **ya no existe**: la 139 la retiró a
propósito, ver A.3.)

**Consecuencia operativa que se acepta y se deja escrita:** rescatar a mano una orden
atascada en un estado inesperado exigirá **declarar la arista en el módulo y desplegar**
(PR, review, CI). No hay palanca en caliente ni permiso de rol que lo evite. Es el precio
de que R14/R15 sigan significando algo: con un override amplio, la garantía de
conectividad sería decorativa y el grafo dejaría de describir el sistema real.

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
   editable en caliente en producción sin pasar por CI. (Esto es coherente con Q3: si el
   grafo fuera editable en caliente, el "no hay override" se evadiría por la puerta de
   atrás.)
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

**Tercera alternativa descartada (modo shadow):** desplegar la guardia en modo solo-log
durante N días y activarla después. Descartada por el gate (Q7): duplica el trabajo (hay
que volver para activarla, y ese "volver" nunca tiene dueño), deja producción sin la
garantía justo mientras se cree que ya se tiene, y su beneficio real —descubrir aristas no
inventariadas— lo da igual de bien el test data-driven sobre el inventario COMPLETO (T3.4)
sin exponer producción a una ventana ambigua.

## 8. Test de conectividad (R14/R15/R16)

- Construir el grafo dirigido desde `TRANSICIONES` + un nodo virtual `START` con aristas a
  cada `ESTADOS_CREACION`.
- Para cada uno de los 18 `value` de `ORDER_STATUS_SEED`:
  - si NO es terminal: assert `inDegree >= 1` (contando `START`) y `outDegree >= 1`.
  - si es terminal: assert `inDegree >= 1` (un terminal inalcanzable también es un bug).
- Assert de cobertura: `keys(TRANSICIONES) ∪ destinos ∪ terminales ∪ creacion == SEED` (R16).
- El fallo nombra el/los `value` ofensores (R15).
- **Allowlist vestigial:** el mecanismo se conserva DOCUMENTADO pero su conjunto está
  **VACÍO** (Q2 RESUELTA). Hoy ningún `value` del catálogo queda exento de la cobertura ni
  del invariante de entrada/salida. Si un estado futuro naciera sin flujo, ese es el lugar
  donde declararlo — pero declarar algo ahí en esta feature sería un error: la auditoría
  manual de A.3 confirma que **no hace falta**.

---

## Apéndice A — Inventario cerrado de transiciones (fuente: código de `dev`, 2026-07-25)

> **Re-verificado leyendo** `GuiaAsignacionService`, `AsignacionSateliteService`,
> `RecepcionSateliteService`, `MisAsignacionesService`, `CorteDiarioService`+`CierreDiaRepository`,
> `CierresAdminService`+`CierresAdminRepository`, `DevolucionSlaService`+`DevolucionSlaRepository`,
> `DevolucionOrigenService`, `RecepcionOrigenService`, `ReprogramacionTiendaService`,
> `RecuperacionBodegaService`+`RecuperacionBodegaRepository`, `LiberacionReprogramadaService`+
> `LiberacionReprogramadaRepository`, `CierreDiaService`(deshacer)+`CierreDiaRepository`,
> `RecepcionBodegaCentralService`, `EnvioDevolucionCentralService`, `OrdenRepository`
> (`cancelarViaApi`/`create`/`update`/`createManyOrdenes`/`createManyOrdenesConGuia`/
> `recibirEnSatelite`/`recibirLoteEnSatelite`/`recibirEnOrigen`/`recibirEnBodegaCentral`/
> `generarGuiaLote`/`asignarBodegaLote`/`rutearBodegaSateliteLote`/`asignarSateliteLote`),
> `OrdenService`(crear/actualizar), `GestionOrdenRepository`, `BulkOrdenService`,
> `lib/types/order-status.ts`, `lib/types/orden-historial.ts`, `lib/config/ordenes.ts`.
> **Nomenclatura post-137 (la que ya está en `dev`).** La tabla A.0 se conserva sólo como
> glosario histórico: el código de hoy YA usa los nombres finales.

### A.0 — Renombres de la feature 137 (nombre viejo -> nombre actual)

| Nombre viejo (pre-137) | Actual (post-137, el del código) |
| --- | --- |
| `en_reparto` | `en_ruta` |
| `en_espera_aceptacion` | `por_recoger` |
| `en_bodega` | `en_bodega_central` |
| `en_ruta_bodega_principal` | `en_ruta_bodega_central` |
| `devuelta_origen` | `devolviendo_a_tienda` |
| `recibido_origen` | `devuelta_a_tienda` (terminal) |

Sin renombre: `entregada`, `devuelta`, `reprogramada`, `en_fulfillment`, `en_preparacion`,
`en_ruta_bodega_satelite`, `rechazada`, `en_bodega_satelite`, `sin_gestionar`.
La **139** añadió TRES valores nuevos (índices 16/17/18 del SEED, sin alterar posiciones
previas): `por_devolver`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda`.
**Total del catálogo: 18 `value`.**

### A.1 — Creación (null -> X)

| Origen | Destino | Familia (`origen_tipo`) | Actor | Call-site |
| --- | --- | --- | --- | --- |
| null | `en_preparacion` (default) / `en_fulfillment` (tienda fulfillment) | `creacion_manual` | usuario autenticado | `OrdenService.crear` -> `OrdenRepository.create` |
| null | `en_preparacion` / `en_fulfillment` | `carga_masiva` | usuario/tienda | `BulkOrdenService` -> `OrdenRepository.createManyOrdenes` |
| null | `en_ruta_bodega_central` (FIJO) | `carga_api` | apiKey/owner | `BulkOrdenService.cargarViaApi` (`ESTATUS_INICIAL_API`) -> `OrdenRepository.createManyOrdenesConGuia` |

`ESTADOS_CREACION = ["en_preparacion", "en_fulfillment", "en_ruta_bodega_central"]`
(Q5 RESUELTA; verificado: `ordenesConfig.DEFAULT_ESTATUS_VALUE = "en_preparacion"`,
`ordenesConfig.FULFILLMENT_ESTATUS_VALUE = "en_fulfillment"`,
`BulkOrdenService.ESTATUS_INICIAL_API = "en_ruta_bodega_central"`).

> **Aviso al implementer (ver A.3-#8):** `OrdenService.crear` acepta hoy un `estatusId`
> explícito arbitrario del catálogo. Con R10 activo, crear fuera de estos tres estados
> pasará a lanzar. Es el efecto deseado de Q5, no una regresión de R8.

### A.2 — Transiciones de flujo (origen no nulo)

> La numeración 1–36 se conserva del borrador para que el diff sea auditable. **El #27 se
> RETIRA** (ver A.3-#2): su hueco es deliberado, no un olvido. Las aristas 37–42 son las
> que aportaron la 138 y la 139.

| # | Origen | Destino | Familia | Actor | Call-site |
| --- | --- | --- | --- | --- | --- |
| 1 | `en_fulfillment` | `por_recoger` | `generacion_guia` | maestro/admin | `GuiaAsignacionService.generarGuia` (GAM+mensajero) |
| 2 | `en_fulfillment` | `en_bodega_central` | `generacion_guia` | maestro/admin | `generarGuia` (GAM sin mensajero) |
| 3 | `en_fulfillment` | `en_ruta_bodega_satelite` | `generacion_guia` | maestro/admin | `generarGuia` (no-GAM) |
| 4 | `en_preparacion` | `por_recoger` | `generacion_guia` | maestro/admin | `generarGuia` (GAM+mensajero) |
| 5 | `en_preparacion` | `en_bodega_central` | `generacion_guia` | maestro/admin | `generarGuia` (GAM sin mensajero) |
| 6 | `en_preparacion` | `en_ruta_bodega_satelite` | `generacion_guia` | maestro/admin | `generarGuia` (no-GAM) |
| 7 | `en_bodega_central` | `en_ruta_bodega_satelite` | `ruteo_satelite` | maestro/admin | `GuiaAsignacionService.rutearABodegaSatelite` |
| 7b | `en_fulfillment` | `en_ruta_bodega_satelite` | `ruteo_satelite` | maestro/admin | `rutearABodegaSatelite` (`ORIGEN_RUTEO_SATELITE`, `GuiaAsignacionService.ts:35`) — añadida en el review |
| 7c | `en_preparacion` | `en_ruta_bodega_satelite` | `ruteo_satelite` | maestro/admin | `rutearABodegaSatelite` (`ORIGEN_RUTEO_SATELITE`, `GuiaAsignacionService.ts:35`) — añadida en el review |
| 8 | `en_bodega_central` | `por_recoger` | `asignacion_bodega` | maestro/admin | `GuiaAsignacionService.asignarDesdeBodega` |
| 9 | `en_bodega_satelite` | `por_recoger` | `asignacion_satelite` | adminSatelite | `AsignacionSateliteService.asignar` |
| 10 | `en_ruta_bodega_satelite` | `en_bodega_satelite` | `recepcion_satelite` | adminSatelite | `RecepcionSateliteService.recibir`/`recibirLote` |
| 11 | `por_recoger` | `en_ruta` | `recoleccion` | mensajero | `MisAsignacionesService.recogerAsignaciones` |
| 12 | `en_ruta` | `entregada` | `gestion` | mensajero | `MisAsignacionesService.gestionar` |
| 13 | `en_ruta` | `reprogramada` | `gestion` | mensajero | `gestionar` |
| 14 | `en_ruta` | `devuelta` | `gestion` | mensajero | `gestionar` |
| 15 | `en_ruta` | `rechazada` | `gestion` | mensajero | `gestionar` |
| 16 | `en_ruta` | `sin_gestionar` | `corte_sin_gestionar` | sistema/cron | `CorteDiarioService` -> `CierreDiaRepository.crearCierre` |
| 17 | `sin_gestionar` | `en_bodega_central` | `liberacion_sin_gestionar` | admin (aprobar) | `CierresAdminService.aprobarCierre` -> `CierresAdminRepository.resolverCierre` |
| 18 | `sin_gestionar` | `en_bodega_satelite` | `liberacion_sin_gestionar` | admin (aprobar) | `resolverCierre` |
| 19 | `devuelta` | `en_bodega_central` | `liberacion_devuelta_sla` | sistema/cron | `DevolucionSlaService` -> `liberarDevueltaSla` (reintento) |
| 20 | `devuelta` | `en_bodega_satelite` | `liberacion_devuelta_sla` | sistema/cron | `liberarDevueltaSla` (reintento) |
| 21 | `devuelta` | `rechazada` | `escalado_devuelta_sla` | sistema/cron | `escalarDevueltaSla` (escalado + gestión sintética) |
| 22 | `devuelta` | `reprogramada` | `reprogramacion_tienda` | adminTienda | `ReprogramacionTiendaService.reprogramar` |
| 23 | `devuelta` | `en_bodega_central` | `recuperacion_manual` | maestro/admin/adminSatelite | `RecuperacionBodegaService.recuperar` |
| 24 | `devuelta` | `en_bodega_satelite` | `recuperacion_manual` | adminSatelite | `recuperar` |
| 25 | `reprogramada` | `en_bodega_central` | `liberacion_reprogramada` | sistema/cron | `LiberacionReprogramadaService` -> `liberarOrden` |
| 26 | `reprogramada` | `en_bodega_satelite` | `liberacion_reprogramada` | sistema/cron | `liberarOrden` |
| ~~27~~ | ~~`rechazada`~~ | ~~`devolviendo_a_tienda`~~ | — | — | **RETIRADA por la 139 (su R9). NO declarar** (ver A.3-#2) |
| 28 | `devolviendo_a_tienda` | `devuelta_a_tienda` | `ajuste_estado` | adminTienda | `RecepcionOrigenService.recibirEnOrigen` |
| 29 | `en_bodega_central` | `devolviendo_a_tienda` | `cancelacion_api` | apiKey (tienda) | `OrdenRepository.cancelarViaApi` |
| 30 | `en_ruta_bodega_central` | `devolviendo_a_tienda` | `cancelacion_api` | apiKey (tienda) | `cancelarViaApi` |
| 31 | `entregada` | `en_ruta` | `deshacer_gestion` | mensajero | `CierreDiaService.deshacerGestion` |
| 32 | `reprogramada` | `en_ruta` | `deshacer_gestion` | mensajero | `deshacerGestion` |
| 33 | `rechazada` | `en_ruta` | `deshacer_gestion` | mensajero | `deshacerGestion` |
| 34 | `en_bodega_central` | `en_ruta` | `deshacer_gestion` | mensajero | `deshacerGestion` (rama `devuelta`) |
| 35 | `en_bodega_satelite` | `en_ruta` | `deshacer_gestion` | mensajero | `deshacerGestion` (rama `devuelta`) |
| 36 | `devuelta` | `en_ruta` | `deshacer_gestion` | mensajero | `deshacerGestion` (defensa filas legadas) |
| 37 | `en_ruta_bodega_central` | `en_bodega_central` | `recepcion_bodega_central` | maestro/admin | `RecepcionBodegaCentralService` -> `OrdenRepository.recibirEnBodegaCentral` (**138**) |
| 38 | `rechazada` | `por_devolver` | `devolucion_rechazada` | admin (aprobar cierre; orden de zona SATÉLITE) | `CierresAdminRepository.resolverCierre` (**139**) |
| 39 | `rechazada` | `por_devolver_a_tienda` | `devolucion_rechazada` | admin (aprobar cierre; orden de zona CENTRAL) | `CierresAdminRepository.resolverCierre` (**139**) |
| 40 | `por_devolver` | `devolviendo_a_bodega_central` | `ajuste_estado` | adminSatelite (de la zona) | `EnvioDevolucionCentralService.enviarACentral` -> `OrdenRepository.update` (**139**) |
| 41 | `devolviendo_a_bodega_central` | `por_devolver_a_tienda` | `recepcion_bodega_central` | maestro/admin | `RecepcionBodegaCentralService` (state-aware) -> `recibirEnBodegaCentral` (**139**) |
| 42 | `por_devolver_a_tienda` | `devolviendo_a_tienda` | `ajuste_estado` | maestro/admin (central) | `DevolucionOrigenService.devolverATienda` -> `OrdenRepository.update` (**139**) |

**Escape hatch:** `OrdenService.actualizar` (`ajuste_estado`) puede hoy producir cualquier
`origen -> destino` del catálogo; en el mapa NO se declara `ANY -> ANY` (R9/Q3). Las
aristas #28, #40 y #42 cubren los usos de `ajuste_estado` de flujo real.

### A.3 — Recuento, discrepancias código-vs-spec y auditoría de conectividad

#### Recuento

- **43 transiciones de flujo distintas por call-site** (numeración 1–42 con el #27
  retirado, más #7b/#7c): 35 heredadas del borrador + 6 nuevas de 138/139 + 2 añadidas
  durante el review (#7b/#7c: `ruteo_satelite` también admite origen `en_fulfillment` y
  `en_preparacion`, según `ORIGEN_RUTEO_SATELITE` en `GuiaAsignacionService.ts:35`).
- Colapsan a **39 pares dirigidos `(origen, destino)` únicos**: las parejas #19/#23
  (`devuelta -> en_bodega_central`) y #20/#24 (`devuelta -> en_bodega_satelite`) comparten
  par y difieren sólo en familia; #7b/#7c comparten par con #3/#6 (mismo
  `origen -> en_ruta_bodega_satelite`, distinta familia) — **la legalidad no cambia**.
- Más **3 aristas de creación** (`START -> en_preparacion` / `en_fulfillment` /
  `en_ruta_bodega_central`).
- **22 familias `origen_tipo` de las 22 del enum** quedan cubiertas: 19 de flujo
  (`generacion_guia`, `ruteo_satelite`, `asignacion_bodega`, `asignacion_satelite`,
  `recepcion_satelite`, `recoleccion`, `gestion`, `corte_sin_gestionar`,
  `liberacion_sin_gestionar`, `liberacion_devuelta_sla`, `escalado_devuelta_sla`,
  `reprogramacion_tienda`, `recuperacion_manual`, `liberacion_reprogramada`,
  `ajuste_estado`, `cancelacion_api`, `deshacer_gestion`, `recepcion_bodega_central`,
  `devolucion_rechazada`) + 3 de creación (`creacion_manual`, `carga_masiva`, `carga_api`).
  Ninguna familia del enum queda huérfana.

#### Discrepancias detectadas entre el borrador del spec y el código (manda el código)

1. **Catálogo: 18 values, no 15.** El borrador asumía que la 139 añadía UN estado
   (`devolviendo_a_bodega_central`). Añadió **TRES**: `por_devolver` (16),
   `devolviendo_a_bodega_central` (17), `por_devolver_a_tienda` (18).
2. **La arista #27 (`rechazada -> devolviendo_a_tienda`) YA NO EXISTE.** La 139 la retiró
   deliberadamente (su R9): la ÚNICA salida de `rechazada` hacia la devolución es ahora la
   aprobación del cierre (#38/#39). Verificado en `DevolucionOrigenService`, cuyo
   `ESTADO_ORIGEN` pasó de `rechazada` a `por_devolver_a_tienda` y devuelve `conflict` si
   la orden sigue en `rechazada`. **Declararla reabriría un camino que la 139 cerró a
   propósito: NO declarar.**
3. **`DevolucionOrigenService` fue repurposado, no eliminado.** Origen
   `por_devolver_a_tienda`, destino `devolviendo_a_tienda`, y su autorización dejó de ser
   por zona (`esBodegaResponsable`) para ser central directa (maestro/admin, `esAccesoTotal`).
   Sigue usando `origen_tipo = ajuste_estado` vía `OrdenRepository.update`.
4. **`RecepcionSateliteService` NO ganó aristas nuevas con la 139.** Aparece tocado, pero
   sólo en el LISTADO: ahora lista `por_devolver` (accionable "enviar a central") y
   `devolviendo_a_bodega_central` (informativo) acotados a la zona. Sus únicas transiciones
   siguen siendo la #10 (`recibir` / `recibirLote`). La transición de "enviar a central"
   la ejecuta `EnvioDevolucionCentralService` (#40), no este service.
5. **`CierreDiaService.deshacerGestion` sigue produciendo #31–#36 tal cual**, incluida
   `rechazada -> en_ruta` (#33): `ESTADOS_ESPERADOS` mantiene
   `{entregada:[entregada], reprogramada:[reprogramada], rechazada:[rechazada],
   devuelta:[en_bodega_central, en_bodega_satelite, rechazada, devuelta]}`. **Sobrevivió a
   la 139.** Matiz operativo (no cambia el mapa): tras la 139, una `rechazada` cuyo cierre
   ya fue APROBADO ya no está en `rechazada` (pasó a #38/#39), así que #33 sólo es
   alcanzable ANTES de aprobar el cierre. La arista se declara igual.
6. **`OrdenRepository.cancelarViaApi` conserva #29/#30**: `ESTADOS_CANCELABLES_API =
   ["en_bodega_central", "en_ruta_bodega_central"]`, destino `devolviendo_a_tienda`,
   `origen_tipo = cancelacion_api`. Sin cambios.
7. **Los `origen_tipo` citados existen todos** en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, que
   pasó de 20 a **22** valores: la 138 sumó `recepcion_bodega_central` y la 139 sumó
   `devolucion_rechazada`.
8. **Creación con `estatusId` explícito (nuevo hallazgo).** `crearOrdenSchema.estatusId`
   es opcional y `OrdenService.crear` sólo lo valida con `existsEstatus`: hoy se puede
   crear una orden directamente en CUALQUIER estado del catálogo. Con R10/Q5 activos, eso
   pasa a lanzar salvo los tres de `ESTADOS_CREACION`. Cambio de comportamiento
   DELIBERADO; el implementer debe esperar que un test existente que cree órdenes en
   estados arbitrarios (si lo hay) tenga que ajustarse — y **ajustar el test, no aflojar
   la guardia**.
9. **`RecepcionBodegaCentralService` es un ÚNICO escáner state-aware** (138 + 139): resuelve
   el par origen->destino por el estado actual y emite ambas aristas (#37 y #41) con la
   MISMA familia `recepcion_bodega_central`. No son dos call-sites distintos.
10. **`en_ruta_bodega_central` dejó de ser una anomalía.** El borrador lo reportaba como
    cuello de botella sin entrada de flujo (Q2). Hoy entra por `START` (carga API, A.1) y
    sale por #30 y #37. **Sin allowlist vestigial: el conjunto de vestigiales es VACÍO.**

#### Auditoría de conectividad (hecha a mano sobre el mapa actualizado)

Grado de entrada/salida de los 18 `value` (`START` = nodo virtual de creación):

| `value` | Entradas | Salidas | Veredicto |
| --- | --- | --- | --- |
| `en_preparacion` | START | #4 #5 #6 | OK (creación) |
| `en_fulfillment` | START | #1 #2 #3 | OK (creación) |
| `en_ruta_bodega_central` | START | #30 #37 | OK (creación; ya no es cuello de botella) |
| `en_bodega_central` | #2 #5 #17 #19 #23 #25 #37 | #7 #8 #29 #34 | OK |
| `en_ruta_bodega_satelite` | #3 #6 #7 | #10 | OK |
| `en_bodega_satelite` | #10 #18 #20 #24 #26 | #9 #35 | OK |
| `por_recoger` | #1 #4 #8 #9 | #11 | OK |
| `en_ruta` | #11 #31 #32 #33 #34 #35 #36 | #12 #13 #14 #15 #16 | OK |
| `entregada` | #12 | #31 | OK (**terminal**; exento de necesitar salida) |
| `reprogramada` | #13 #22 | #25 #26 #32 | OK |
| `devuelta` | #14 | #19 #20 #21 #22 #23 #24 #36 | OK |
| `rechazada` | #15 #21 | #33 #38 #39 | OK |
| `sin_gestionar` | #16 | #17 #18 | OK |
| `por_devolver` | #38 | #40 | OK |
| `devolviendo_a_bodega_central` | #40 | #41 | OK |
| `por_devolver_a_tienda` | #39 #41 | #42 | OK |
| `devolviendo_a_tienda` | #29 #30 #42 | #28 | OK |
| `devuelta_a_tienda` | #28 | — | OK (**terminal**; salida 0 esperada) |

**Resultado: 0 callejones sin salida y 0 cuellos de botella.** Todo estado no terminal
tiene ≥1 entrada y ≥1 salida; ambos terminales tienen ≥1 entrada. La cobertura del
catálogo es exacta (18/18). **Se espera que T3.1 pase en verde a la primera**; si falla,
es una divergencia real que el implementer debe investigar contra el código, NO un
"hallazgo conocido" que se pueda silenciar con una allowlist.

**Terminales:** `entregada` conserva una salida legítima (#31, deshacer gestión); el test
exime a los terminales de NECESITAR salida (R14) pero exige que tengan entrada, y no
prohíbe que la tengan.
