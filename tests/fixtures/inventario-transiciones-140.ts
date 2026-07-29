import type { OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (T3.2/T3.4) — INVENTARIO CERRADO del apendice A de
// `specs/140-flujo-estados-guardia-central/design.md`, transcrito A MANO desde la tabla del
// spec (NO derivado de `TRANSICIONES`: si se generase del propio mapa, el test no probaria
// nada — comprobaria que el mapa es igual a si mismo).
//
// Es la RED DE SEGURIDAD de la activacion estricta (Q7): si una arista real faltara en
// `TRANSICIONES`, ese flujo se caeria en produccion. Por eso los tests que lo consumen
// recorren el inventario COMPLETO (45 aristas de flujo + 4 de creacion), no un muestreo.
//
// Feature 154 (SOLO ADITIVA, decision Q2 del gate del 2026-07-29): sumo #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, sin retirar ninguna fila, porque `GuiaAsignacionService`
// seguia ejecutando las seis que el spec original proponia dar de baja (#1/#3/#4/#6/#7b/#7c).
// Las dos aristas nuevas quedan DECLARADAS y SIN PRODUCTOR: su `callSite` lo documenta.
//
// Feature 149 (SOLO ADITIVA): suma TRES aristas de la familia `deshacer_asignacion`. El spec las
// numeraba #43/#44/#45; al integrar `dev` se RENUMERARON a #45/#46/#47, porque la 154 ya habia
// tomado #43/#44 mientras la 149 iba en su rama.
//
// Feature 156 (recableado de `generarGuia`): RETIRA #4, #6 y #7c. Generar guia deja de asignar
// mensajero y de rutear a satelite (se van #4 y #6), y `rutearABodegaSatelite` pasa a admitir
// SOLO `en_bodega_central` (se va #7c). #5 sobrevive: es el destino unico de generar guia.
// Las cuatro de `en_fulfillment` (#1/#2/#3/#7b) se quedan aqui pero pasan a SIN PRODUCTOR: la
// 156 les quito el call-site y la 155 les quitara la arista junto con el estado.
//
// La numeracion `n` es la del apendice (#1-#42) con huecos deliberados: el #27 lo retiro la
// feature 139 (`rechazada -> devolviendo_a_tienda`) y el #4/#6/#7c los retira la 156.
//
// CORRECCION sobre el apendice A (hallazgo del review, hoy parcialmente superada): el apendice
// solo listaba #7 para `rutearABodegaSatelite`, cuando `ORIGEN_RUTEO_SATELITE` admitia TRES
// origenes; por eso se anadieron #7b/#7c. Tras la 156 esa constante vuelve a ser un solo
// origen (`en_bodega_central`), asi que #7c desaparece y #7b queda sin productor.

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

/** A.2 — 45 aristas de flujo (1-42 sin #27/#4/#6, + #7b del review, + #43/#44 de la 154, + #45/#46/#47 de la 149). */
export const INVENTARIO_FLUJO: readonly AristaInventario[] = [
  // #1/#2/#3/#7b: la 156 dejo `en_fulfillment` sin call-site (ni `generarGuia` ni
  // `rutearABodegaSatelite` lo admiten ya como origen). Siguen declaradas hasta la 155.
  { n: "1", origen: "en_fulfillment", destino: "por_recoger", via: "generacion_guia", callSite: "SIN PRODUCTOR (156): la retira la 155 con el estado" },
  { n: "2", origen: "en_fulfillment", destino: "en_bodega_central", via: "generacion_guia", callSite: "SIN PRODUCTOR (156): la retira la 155 con el estado" },
  { n: "3", origen: "en_fulfillment", destino: "en_ruta_bodega_satelite", via: "generacion_guia", callSite: "SIN PRODUCTOR (156): la retira la 155 con el estado" },
  // #4 RETIRADA por la feature 156: `en_preparacion -> por_recoger` ya no existe (generar
  // guia no asigna mensajero).
  { n: "5", origen: "en_preparacion", destino: "en_bodega_central", via: "generacion_guia", callSite: "GuiaAsignacionService.generarGuia (destino UNICO, 156)" },
  // #6 RETIRADA por la feature 156: `en_preparacion -> en_ruta_bodega_satelite` via
  // `generacion_guia` ya no existe (generar guia no rutea a satelite).
  { n: "7", origen: "en_bodega_central", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "GuiaAsignacionService.rutearABodegaSatelite (origen UNICO, 156)" },
  { n: "7b", origen: "en_fulfillment", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "SIN PRODUCTOR (156): la retira la 155 con el estado" },
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
  // Feature 149 (design §2, R27): reversion de la asignacion/ruteo ANTES de la recogida. Las
  // TRES aristas son pares NUEVOS (no repiten ningun par ya declarado), por eso suben tanto el
  // recuento de aristas (42 -> 45) como el de pares unicos (39 -> 42).
  { n: "45", origen: "en_ruta_bodega_satelite", destino: "en_bodega_central", via: "deshacer_asignacion", callSite: "deshacerAsignacionLote (149, caso b)" },
  { n: "46", origen: "por_recoger", destino: "en_bodega_central", via: "deshacer_asignacion", callSite: "DeshacerAsignacionService.deshacer -> OrdenRepository.deshacerAsignacionLote (149, caso a central)" },
  { n: "47", origen: "por_recoger", destino: "en_bodega_satelite", via: "deshacer_asignacion", callSite: "deshacerAsignacionLote (149, caso a satelite)" },
];

/**
 * A.1 — 4 aristas de creacion (`null -> X`), una por DESTINO (asi las cuenta A.3). El `via`
 * de cada fila es representativo y cubre las familias de creacion del enum:
 * `creacion_manual` y `carga_masiva` pueden producir indistintamente `en_preparacion` o
 * `en_fulfillment` (segun el flag fulfillment de la tienda); `carga_api` produce SIEMPRE
 * `en_ruta_bodega_central` (`ESTATUS_INICIAL_API`). La legalidad no depende del `via` (R2).
 * Feature 154: se suma `por_recolectar_en_tienda`, LEGAL como estado de nacimiento pero SIN
 * PRODUCTOR hasta que la 155 bifurque la creacion por bodega.
 */
export const INVENTARIO_CREACION: readonly AristaCreacionInventario[] = [
  { destino: "en_preparacion", via: "creacion_manual", callSite: "OrdenService.crear -> OrdenRepository.create" },
  { destino: "en_fulfillment", via: "carga_masiva", callSite: "BulkOrdenService -> createManyOrdenes" },
  { destino: "en_ruta_bodega_central", via: "carga_api", callSite: "BulkOrdenService.cargarViaApi -> createManyOrdenesConGuia" },
  { destino: "por_recolectar_en_tienda", via: "creacion_manual", callSite: "SIN PRODUCTOR (154): bifurcacion de creacion por bodega, feature 155" },
];

/**
 * Recuentos: 45 aristas de flujo, 42 pares dirigidos unicos y 4 de creacion.
 *
 * Cadena: la 156 dejo el inventario en 42 aristas / 39 pares (las 45 previas menos #4/#6/#7c).
 * De 45 a 42 fueron -3 aristas y de 41 a 39 pares: `en_preparacion -> por_recoger` (#4) era un
 * par unico y desaparecio; `en_preparacion -> en_ruta_bodega_satelite` estaba declarado dos veces
 * (#6 `generacion_guia` + #7c `ruteo_satelite`) y desaparecieron las dos, asi que el par tambien.
 * La 149 suma sus TRES aristas (#45/#46/#47), y como las tres son pares NUEVOS suben ambos
 * recuentos por igual: 42 -> 45 aristas y 39 -> 42 pares. Los 45 - 42 = 3 duplicados que quedan
 * son #19/#23, #20/#24 y #3/#7b.
 */
export const RECUENTO_INVENTARIO = {
  aristasFlujo: 45,
  paresUnicos: 42,
  aristasCreacion: 4,
} as const;
