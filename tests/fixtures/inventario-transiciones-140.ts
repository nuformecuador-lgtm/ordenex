import type { OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (T3.2/T3.4) — INVENTARIO CERRADO del apendice A de
// `specs/140-flujo-estados-guardia-central/design.md`, transcrito A MANO desde la tabla del
// spec (NO derivado de `TRANSICIONES`: si se generase del propio mapa, el test no probaria
// nada — comprobaria que el mapa es igual a si mismo).
//
// Es la RED DE SEGURIDAD de la activacion estricta (Q7): si una arista real faltara en
// `TRANSICIONES`, ese flujo se caeria en produccion. Por eso los tests que lo consumen
// recorren el inventario COMPLETO (38 aristas de flujo + 2 de creacion), no un muestreo.
//
// Feature 154 (SOLO ADITIVA, decision Q2 del gate del 2026-07-29): sumo #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, sin retirar ninguna fila, porque `GuiaAsignacionService`
// seguia ejecutando las seis que el spec original proponia dar de baja (#1/#3/#4/#6/#7b/#7c).
//
// Feature 156 (recableado de `generarGuia`): RETIRA #4, #6 y #7c. Generar guia deja de asignar
// mensajero y de rutear a satelite (se van #4 y #6), y `rutearABodegaSatelite` pasa a admitir
// SOLO `en_bodega_central` (se va #7c). #5 sobrevive: es el destino unico de generar guia.
//
// Feature 155 (retiro del estado de fulfillment): RETIRA sus cuatro aristas (#1/#2/#3/#7b), que
// la 156 habia dejado sin productor, y DOS entradas de creacion — la del propio estado y
// `en_ruta_bodega_central` (el `ESTATUS_INICIAL_API` del canal por API key, que dejaba la orden
// viajando sin haber sido recolectada). Las de creacion pasan de 4 a 2 y las dos que quedan son
// EXACTAMENTE las dos salidas de `resolverDestinoCreacion`. La entrada
// `por_recolectar_en_tienda` deja de estar SIN PRODUCTOR: la 155 la produce por las tres vias.
//
// La numeracion `n` es la del apendice (#1-#44) con huecos deliberados: #27 lo retiro la 139
// (`rechazada -> devolviendo_a_tienda`), #4/#6/#7c la 156 y #1/#2/#3/#7b la 155.
//
// CORRECCION sobre el apendice A (hallazgo del review, hoy superada): el apendice solo listaba
// #7 para `rutearABodegaSatelite`, cuando `ORIGEN_RUTEO_SATELITE` admitia TRES origenes; por eso
// se anadieron #7b/#7c. Tras la 156 esa constante vuelve a ser un solo origen
// (`en_bodega_central`) y tras la 155 los dos anadidos ya no existen.

/** Una arista de flujo del inventario (origen no nulo). */
export interface AristaInventario {
  /** Numero de fila en la tabla A.2 del apendice (`7b`/`7c` = correccion del review). */
  n: string;
  origen: OrderStatusValue;
  destino: OrderStatusValue;
  via: OrdenHistorialOrigenTipo;
  /** Call-site que la ejecuta (documental, no participa de la asercion). */
  callSite: string;
}

/** Una arista de creacion del inventario (`null -> X`, tabla A.1). */
export interface AristaCreacionInventario {
  destino: OrderStatusValue;
  via: OrdenHistorialOrigenTipo;
  callSite: string;
}

/** A.2 — 38 aristas de flujo (1-44 sin #27, #4/#6/#7c de la 156 y #1/#2/#3/#7b de la 155). */
export const INVENTARIO_FLUJO: readonly AristaInventario[] = [
  // #1/#2/#3/#7b RETIRADAS por la feature 155 junto con el estado del que salian. Estaban SIN
  // PRODUCTOR desde la 156 y su backfill (`20260729140000_order_status_retiro_en_fulfillment`)
  // deja vacio el conjunto de ordenes que las necesitaban: retirarlas no atrapa a ninguna.
  // #4 RETIRADA por la feature 156: `en_preparacion -> por_recoger` ya no existe (generar
  // guia no asigna mensajero).
  { n: "5", origen: "en_preparacion", destino: "en_bodega_central", via: "generacion_guia", callSite: "GuiaAsignacionService.generarGuia (destino UNICO, 156)" },
  // #6 RETIRADA por la feature 156: `en_preparacion -> en_ruta_bodega_satelite` via
  // `generacion_guia` ya no existe (generar guia no rutea a satelite).
  { n: "7", origen: "en_bodega_central", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "GuiaAsignacionService.rutearABodegaSatelite (origen UNICO, 156)" },
  // #7c RETIRADA por la feature 156: `ORIGEN_RUTEO_SATELITE` vuelve a ser un solo origen.
  { n: "8", origen: "en_bodega_central", destino: "por_recoger", via: "asignacion_bodega", callSite: "GuiaAsignacionService.asignarDesdeBodega" },
  { n: "9", origen: "en_bodega_satelite", destino: "por_recoger", via: "asignacion_satelite", callSite: "AsignacionSateliteService.asignar" },
  { n: "10", origen: "en_ruta_bodega_satelite", destino: "en_bodega_satelite", via: "recepcion_satelite", callSite: "RecepcionSateliteService.recibir/recibirLote" },
  { n: "11", origen: "por_recoger", destino: "en_reparto", via: "recoleccion", callSite: "MisAsignacionesService.recogerAsignaciones" },
  { n: "12", origen: "en_reparto", destino: "entregada", via: "gestion", callSite: "MisAsignacionesService.gestionar" },
  { n: "13", origen: "en_reparto", destino: "reprogramada", via: "gestion", callSite: "gestionar" },
  { n: "14", origen: "en_reparto", destino: "devuelta", via: "gestion", callSite: "gestionar" },
  { n: "15", origen: "en_reparto", destino: "rechazada", via: "gestion", callSite: "gestionar" },
  { n: "16", origen: "en_reparto", destino: "sin_gestionar", via: "corte_sin_gestionar", callSite: "CorteDiarioService -> CierreDiaRepository.crearCierre" },
  { n: "17", origen: "sin_gestionar", destino: "en_bodega_central", via: "liberacion_sin_gestionar", callSite: "CierresAdminService.aprobarCierre -> resolverCierre" },
  { n: "18", origen: "sin_gestionar", destino: "en_bodega_satelite", via: "liberacion_sin_gestionar", callSite: "resolverCierre" },
  { n: "19", origen: "devuelta", destino: "en_bodega_central", via: "liberacion_devuelta_sla", callSite: "DevolucionSlaRepository.liberarDevueltaSla" },
  { n: "20", origen: "devuelta", destino: "en_bodega_satelite", via: "liberacion_devuelta_sla", callSite: "liberarDevueltaSla" },
  { n: "21", origen: "devuelta", destino: "rechazada", via: "escalado_devuelta_sla", callSite: "escalarDevueltaSla" },
  { n: "22", origen: "devuelta", destino: "reprogramada", via: "reprogramacion_tienda", callSite: "ReprogramacionTiendaService.reprogramar" },
  { n: "23", origen: "devuelta", destino: "en_bodega_central", via: "recuperacion_manual", callSite: "RecuperacionBodegaService.recuperar" },
  { n: "24", origen: "devuelta", destino: "en_bodega_satelite", via: "recuperacion_manual", callSite: "recuperar" },
  { n: "25", origen: "reprogramada", destino: "en_bodega_central", via: "liberacion_reprogramada", callSite: "LiberacionReprogramadaRepository.liberarOrden" },
  { n: "26", origen: "reprogramada", destino: "en_bodega_satelite", via: "liberacion_reprogramada", callSite: "liberarOrden" },
  // #27 RETIRADA por la feature 139 (su R9): `rechazada -> devolviendo_a_tienda` NO existe.
  { n: "28", origen: "devolviendo_a_tienda", destino: "devuelta_a_tienda", via: "ajuste_estado", callSite: "RecepcionOrigenService.recibirEnOrigen" },
  { n: "29", origen: "en_bodega_central", destino: "devolviendo_a_tienda", via: "cancelacion_api", callSite: "OrdenRepository.cancelarViaApi" },
  { n: "30", origen: "en_ruta_bodega_central", destino: "devolviendo_a_tienda", via: "cancelacion_api", callSite: "cancelarViaApi" },
  { n: "31", origen: "entregada", destino: "en_reparto", via: "deshacer_gestion", callSite: "CierreDiaService.deshacerGestion" },
  { n: "32", origen: "reprogramada", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion" },
  { n: "33", origen: "rechazada", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion" },
  { n: "34", origen: "en_bodega_central", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (rama devuelta)" },
  { n: "35", origen: "en_bodega_satelite", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (rama devuelta)" },
  { n: "36", origen: "devuelta", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (defensa filas legadas)" },
  { n: "37", origen: "en_ruta_bodega_central", destino: "en_bodega_central", via: "recepcion_bodega_central", callSite: "RecepcionBodegaCentralService (138)" },
  { n: "38", origen: "rechazada", destino: "por_devolver", via: "devolucion_rechazada", callSite: "CierresAdminRepository.resolverCierre (139, zona satelite)" },
  { n: "39", origen: "rechazada", destino: "por_devolver_a_tienda", via: "devolucion_rechazada", callSite: "resolverCierre (139, zona central)" },
  { n: "40", origen: "por_devolver", destino: "devolviendo_a_bodega_central", via: "ajuste_estado", callSite: "EnvioDevolucionCentralService.enviarACentral (139)" },
  { n: "41", origen: "devolviendo_a_bodega_central", destino: "por_devolver_a_tienda", via: "recepcion_bodega_central", callSite: "RecepcionBodegaCentralService state-aware (139)" },
  { n: "42", origen: "por_devolver_a_tienda", destino: "devolviendo_a_tienda", via: "ajuste_estado", callSite: "DevolucionOrigenService.devolverATienda (139)" },
  // #43/#44: feature 154. DECLARADAS Y SIN PRODUCTOR — ningun service las ejecuta todavia; el
  // `callSite` nombra la feature que lo hara. Por eso NO aparecen en el mapa de puntos de
  // escritura de `tests/unit/repositories/orden-historial-cobertura.test.ts`.
  { n: "43", origen: "por_recolectar_en_tienda", destino: "en_ruta_bodega_central", via: "recoleccion_tienda", callSite: "SIN PRODUCTOR (154): escaner de recoleccion en tienda, feature 157" },
  { n: "44", origen: "en_reparto", destino: "incidente", via: "gestion", callSite: "SIN PRODUCTOR (154): resultado `incidente` de la gestion, feature 158" },
];

/**
 * A.1 — 2 aristas de creacion (`null -> X`), una por DESTINO (asi las cuenta A.3). El `via`
 * de cada fila es representativo: la legalidad no depende del `via` (R2), y tras la feature 155
 * las TRES vias (`creacion_manual`, `carga_masiva`, `carga_api`) pueden producir CUALQUIERA de
 * los dos destinos — el que resuelva `resolverDestinoCreacion` a partir del flag `fulfillment`
 * de la tienda dueña, y nada mas.
 *
 * Feature 155: se retiran las entradas del estado de fulfillment (backfilleado a
 * `en_preparacion`) y de `en_ruta_bodega_central` (el `ESTATUS_INICIAL_API` del canal por API
 * key), y `por_recolectar_en_tienda` deja de estar SIN PRODUCTOR.
 */
export const INVENTARIO_CREACION: readonly AristaCreacionInventario[] = [
  { destino: "en_preparacion", via: "creacion_manual", callSite: "las 3 vias con fulfillment=true: OrdenService.crear / BulkOrdenService.cargarMasiva / .cargarViaApi" },
  { destino: "por_recolectar_en_tienda", via: "carga_masiva", callSite: "las 3 vias con fulfillment=false (rama b, con num_guia en el acto)" },
];

/**
 * Recuentos: 38 aristas de flujo, 36 pares dirigidos unicos y 2 de creacion.
 *
 * De 42 a 38: -4 aristas (#1/#2/#3/#7b, feature 155). De 39 a 36 pares: los tres pares que
 * salian del estado retirado desaparecen enteros — `-> por_recoger` (#1), `-> en_bodega_central`
 * (#2) y `-> en_ruta_bodega_satelite` (#3 y #7b, que compartian par). Los 38 - 36 = 2 duplicados
 * que quedan son #19/#23 y #20/#24 (SLA vs. recuperacion manual).
 */
export const RECUENTO_INVENTARIO = {
  aristasFlujo: 38,
  paresUnicos: 36,
  aristasCreacion: 2,
} as const;
