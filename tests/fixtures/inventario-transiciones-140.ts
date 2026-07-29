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
// Feature 154 (SOLO ADITIVA, decision Q2 del gate del 2026-07-29): suma #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`. NO retira ninguna fila: las seis aristas que el spec
// original proponia retirar (#1/#3/#4/#6/#7b/#7c) las ejecuta HOY `GuiaAsignacionService`, asi
// que su baja se muda a la feature que recablea ese service (155 y 156). Las dos aristas nuevas
// quedan DECLARADAS y SIN PRODUCTOR: su `callSite` documenta la feature que las consumira.
//
// La numeracion `n` es la del apendice (#1-#42) con el #27 RETIRADO a proposito por la
// feature 139 (`rechazada -> devolviendo_a_tienda` ya no existe): el hueco es deliberado.
//
// CORRECCION sobre el apendice A (hallazgo del review): `rutearABodegaSatelite` admite TRES
// origenes (`ORIGEN_RUTEO_SATELITE`, `GuiaAsignacionService.ts:35`), no solo
// `en_bodega_central`. El apendice solo listaba #7 (desde `en_bodega_central`); se anaden
// #7b/#7c (`en_fulfillment`/`en_preparacion` -> `en_ruta_bodega_satelite` via `ruteo_satelite`).
// Son PARES ya declarados (#3/#6, via `generacion_guia`): cambia el metadato de familia y el
// recuento por call-site (41 -> 43), NO la legalidad (39 pares unicos, igual que antes).

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

/** A.2 — 45 aristas de flujo (1-42 sin el #27, mas #7b/#7c del review y #43/#44 de la 154). */
export const INVENTARIO_FLUJO: readonly AristaInventario[] = [
  { n: "1", origen: "en_fulfillment", destino: "por_recoger", via: "generacion_guia", callSite: "GuiaAsignacionService.generarGuia (GAM+mensajero)" },
  { n: "2", origen: "en_fulfillment", destino: "en_bodega_central", via: "generacion_guia", callSite: "generarGuia (GAM sin mensajero)" },
  { n: "3", origen: "en_fulfillment", destino: "en_ruta_bodega_satelite", via: "generacion_guia", callSite: "generarGuia (no-GAM)" },
  { n: "4", origen: "en_preparacion", destino: "por_recoger", via: "generacion_guia", callSite: "generarGuia (GAM+mensajero)" },
  { n: "5", origen: "en_preparacion", destino: "en_bodega_central", via: "generacion_guia", callSite: "generarGuia (GAM sin mensajero)" },
  { n: "6", origen: "en_preparacion", destino: "en_ruta_bodega_satelite", via: "generacion_guia", callSite: "generarGuia (no-GAM)" },
  { n: "7", origen: "en_bodega_central", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "GuiaAsignacionService.rutearABodegaSatelite" },
  { n: "7b", origen: "en_fulfillment", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "rutearABodegaSatelite (ORIGEN_RUTEO_SATELITE, GuiaAsignacionService.ts:35)" },
  { n: "7c", origen: "en_preparacion", destino: "en_ruta_bodega_satelite", via: "ruteo_satelite", callSite: "rutearABodegaSatelite (ORIGEN_RUTEO_SATELITE, GuiaAsignacionService.ts:35)" },
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
 * Recuentos: 45 aristas de flujo (las 41 de A.3 + #7b/#7c del review + #43/#44 de la 154), 41
 * pares dirigidos unicos (las dos del review repiten pares ya declarados; las dos de la 154
 * estrenan par) y 4 de creacion.
 */
export const RECUENTO_INVENTARIO = {
  aristasFlujo: 45,
  paresUnicos: 41,
  aristasCreacion: 4,
} as const;
