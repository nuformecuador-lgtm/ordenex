import type { OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (T3.2/T3.4) — INVENTARIO CERRADO del apendice A de
// `specs/140-flujo-estados-guardia-central/design.md`, transcrito A MANO desde la tabla del
// spec (NO derivado de `TRANSICIONES`: si se generase del propio mapa, el test no probaria
// nada — comprobaria que el mapa es igual a si mismo).
//
// Es la RED DE SEGURIDAD de la activacion estricta (Q7): si una arista real faltara en
// `TRANSICIONES`, ese flujo se caeria en produccion. Por eso los tests que lo consumen
// recorren el inventario COMPLETO (42 aristas de flujo + 2 de creacion), no un muestreo.
//
// Feature 154 (SOLO ADITIVA, decision Q2 del gate del 2026-07-29): sumo #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, sin retirar ninguna fila, porque `GuiaAsignacionService`
// seguia ejecutando las seis que el spec original proponia dar de baja (#1/#3/#4/#6/#7b/#7c).
//
// Feature 149 (SOLO ADITIVA): suma TRES aristas de la familia `deshacer_asignacion`. El spec las
// numeraba #43/#44/#45; al integrar `dev` se RENUMERARON a #45/#46/#47, porque la 154 ya habia
// tomado #43/#44 mientras la 149 iba en su rama.
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
// Feature 158 (Q-D/Q-G, 2026-07-30), PR 1 (camino del MENSAJERO): suma UNA arista, #53
// (`incidente -> en_reparto`, familia `deshacer_gestion`), y REALINEA el `via` de #44 a
// `incidente`. La #44 deja de estar SIN PRODUCTOR: la 158 es quien la ejecuta.
//
// Feature 158, PR 2 (camino del ADMIN): suma las DIEZ que el PR 1 dejo reservadas — las CINCO
// entradas desde bodega y transito interno (#48-#52) y sus CINCO inversas de reversion
// (#54-#58), todas con la familia `incidente`. Llegan AHORA y no antes porque ahora llega su
// productor (`IncidenteAdminRepository.reportar` / `.resolver`).
//
// La numeracion `n` es la del apendice (#1-#58) con huecos deliberados: #27 lo retiro la 139
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

/** A.2 — 41 aristas de flujo (1-47 sin #27, sin #4/#6/#7c de la 156 y sin #1/#2/#3/#7b de la 155, + #43/#44 de la 154 + #45/#46/#47 de la 149). */
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
  { n: "8", origen: "en_bodega_central", destino: "mensajero_recogiendo_en_bodega", via: "asignacion_bodega", callSite: "GuiaAsignacionService.asignarDesdeBodega" },
  { n: "9", origen: "en_bodega_satelite", destino: "mensajero_recogiendo_en_bodega", via: "asignacion_satelite", callSite: "AsignacionSateliteService.asignar" },
  { n: "10", origen: "en_ruta_bodega_satelite", destino: "en_bodega_satelite", via: "recepcion_satelite", callSite: "RecepcionSateliteService.recibir" },
  { n: "11", origen: "mensajero_recogiendo_en_bodega", destino: "en_reparto", via: "recoleccion", callSite: "MisAsignacionesService.recogerAsignaciones" },
  { n: "12", origen: "en_reparto", destino: "entregado", via: "gestion", callSite: "MisAsignacionesService.gestionar" },
  { n: "13", origen: "en_reparto", destino: "reprogramado", via: "gestion", callSite: "gestionar" },
  // Feature 239 (2026-08-19): #14 (`en_reparto -> devuelta` por la gestion) queda RETIRADA.
  // FICHA 454 (2026-09-23): #59 (`en_reparto -> devolucion_por_confirmar`, 239) queda RETIRADA con
  // su estado; la gestion se REGISTRA sin transicion y la aprobacion aplica `en_reparto -> devuelta`
  // (#70, abajo).
  { n: "15", origen: "en_reparto", destino: "devolucion_a_origen_por_rechazo", via: "gestion", callSite: "gestionar" },
  { n: "16", origen: "en_reparto", destino: "novedad_interna", via: "corte_sin_gestionar", callSite: "CorteDiarioService -> CierreDiaRepository.crearCierre" },
  { n: "17", origen: "novedad_interna", destino: "en_bodega_central", via: "liberacion_sin_gestionar", callSite: "CierresAdminService.aprobarCierre -> resolverCierre" },
  { n: "18", origen: "novedad_interna", destino: "en_bodega_satelite", via: "liberacion_sin_gestionar", callSite: "resolverCierre" },
  // Feature 276 (T3/T9): la TERCERA salida de `sin_gestionar`, y la unica que NO vuelve a bodega.
  // Misma transaccion, mismo actor y mismo bloque que #17/#18; lo que cambia es el destino cuando
  // la orden ya agoto sus intentos de entrega. Par NUEVO: `sin_gestionar -> rechazada` no estaba
  // declarado por nadie.
  { n: "68", origen: "novedad_interna", destino: "devolucion_a_origen_por_rechazo", via: "rechazo_tope_intentos", callSite: "CierresAdminService.aprobarCierre -> resolverCierre, bloque liberacionSinGestionar (276)" },
  { n: "19", origen: "novedad", destino: "en_bodega_central", via: "liberacion_devuelta_sla", callSite: "DevolucionSlaRepository.liberarDevueltaSla" },
  { n: "20", origen: "novedad", destino: "en_bodega_satelite", via: "liberacion_devuelta_sla", callSite: "liberarDevueltaSla" },
  { n: "21", origen: "novedad", destino: "devolucion_a_origen_por_rechazo", via: "escalado_devuelta_sla", callSite: "escalarDevueltaSla" },
  { n: "22", origen: "novedad", destino: "reprogramado", via: "reprogramacion_tienda", callSite: "ReprogramacionTiendaService.reprogramar" },
  { n: "23", origen: "novedad", destino: "en_bodega_central", via: "recuperacion_manual", callSite: "RecuperacionBodegaService.recuperar" },
  { n: "24", origen: "novedad", destino: "en_bodega_satelite", via: "recuperacion_manual", callSite: "recuperar" },
  { n: "25", origen: "reprogramado", destino: "en_bodega_central", via: "liberacion_reprogramada", callSite: "LiberacionReprogramadaRepository.liberarOrden" },
  { n: "26", origen: "reprogramado", destino: "en_bodega_satelite", via: "liberacion_reprogramada", callSite: "liberarOrden" },
  // #27 RETIRADA por la feature 139 (su R9): `rechazada -> devolviendo_a_tienda` NO existe.
  { n: "28", origen: "devolviendo_a_tienda", destino: "devuelta_a_tienda", via: "ajuste_estado", callSite: "RecepcionOrigenService.recibirEnOrigen" },
  { n: "29", origen: "en_bodega_central", destino: "devolviendo_a_tienda", via: "cancelacion_api", callSite: "OrdenRepository.cancelarViaApi" },
  { n: "30", origen: "en_ruta_bodega_central", destino: "devolviendo_a_tienda", via: "cancelacion_api", callSite: "cancelarViaApi" },
  { n: "31", origen: "entregado", destino: "en_reparto", via: "deshacer_gestion", callSite: "CierreDiaService.deshacerGestion" },
  // ⭑ FICHA 398 (#69) — LA CORRECCION EN SITIO de una entrega mal declarada dentro de un cierre
  // ABIERTO. Es la SEGUNDA salida de `entregada`, y la unica que no es un deshacer del
  // mensajero. Llega CON su productor, que es lo que 235/R12 exige de toda arista nueva.
  { n: "69", origen: "entregado", destino: "devolucion_a_origen_por_rechazo", via: "correccion_resultado_gestion", callSite: "CierresAdminRepository.corregirResultadoGestionEnCierre (398)" },
  { n: "32", origen: "reprogramado", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion" },
  { n: "33", origen: "devolucion_a_origen_por_rechazo", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion" },
  { n: "34", origen: "en_bodega_central", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (rama devuelta)" },
  { n: "35", origen: "en_bodega_satelite", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (rama devuelta)" },
  { n: "36", origen: "novedad", destino: "en_reparto", via: "deshacer_gestion", callSite: "deshacerGestion (defensa filas legadas)" },
  { n: "37", origen: "en_ruta_bodega_central", destino: "en_bodega_central", via: "recepcion_bodega_central", callSite: "RecepcionBodegaCentralService (138)" },
  { n: "38", origen: "devolucion_a_origen_por_rechazo", destino: "por_devolver_a_bodega_central", via: "devolucion_rechazada", callSite: "CierresAdminRepository.resolverCierre (139, zona satelite)" },
  { n: "39", origen: "devolucion_a_origen_por_rechazo", destino: "por_devolver_a_tienda", via: "devolucion_rechazada", callSite: "resolverCierre (139, zona central)" },
  { n: "40", origen: "por_devolver_a_bodega_central", destino: "devolviendo_a_bodega_central", via: "ajuste_estado", callSite: "EnvioDevolucionCentralService.enviarACentral (139)" },
  { n: "41", origen: "devolviendo_a_bodega_central", destino: "por_devolver_a_tienda", via: "recepcion_bodega_central", callSite: "RecepcionBodegaCentralService state-aware (139)" },
  { n: "42", origen: "por_devolver_a_tienda", destino: "devolviendo_a_tienda", via: "ajuste_estado", callSite: "DevolucionOrigenService.devolverATienda (139)" },
  // #43/#44: feature 154. DECLARADAS Y SIN PRODUCTOR — ningun service las ejecuta todavia; el
  // `callSite` nombra la feature que lo hara. Por eso NO aparecen en el mapa de puntos de
  // escritura de `tests/unit/repositories/orden-historial-cobertura.test.ts`.
  // Feature 157 (ampliacion 2026-07-31): la #43 CAMBIA DE ORIGEN. Solo recolecta quien fue
  // asignado, y estar asignado es exactamente lo que significa `recolectando`. Se suman la
  // asignacion (#45b) y su reversion (#46b), que son las que impiden reasignar en bucle.
  { n: "43", origen: "recolectando", destino: "en_ruta_bodega_central", via: "recoleccion_tienda", callSite: "RecoleccionTiendaService.recolectarEnTienda (157)" },
  { n: "45b", origen: "por_recolectar_en_tienda", destino: "recolectando", via: "asignacion_recoleccion", callSite: "GuiaAsignacionService.asignarRecoleccion (157)" },
  { n: "46b", origen: "recolectando", destino: "por_recolectar_en_tienda", via: "deshacer_asignacion", callSite: "GuiaAsignacionService.desasignarRecoleccion (157)" },
  // #44: la 154 la declaro SIN PRODUCTOR y con `via: "gestion"`. La feature 158 le pone
  // PRODUCTOR (`crearGestionYTransicionar` con `resultado = incidente`) y le REALINEA el `via`
  // a la familia `incidente`, que es la que el append persiste (Q-G). La fila NO se borra: se
  // mueve a su verdad nueva.
  { n: "44", origen: "en_reparto", destino: "incidente", via: "incidente", callSite: "MisAsignacionesService.gestionar -> GestionOrdenRepository.crearGestionYTransicionar (158)" },
  // Feature 149 (design §2, R27): reversion de la asignacion/ruteo ANTES de la recogida. Las
  // TRES aristas son pares NUEVOS (no repiten ningun par ya declarado), por eso suben tanto el
  // recuento de aristas (42 -> 45) como el de pares unicos (39 -> 42).
  { n: "45", origen: "en_ruta_bodega_satelite", destino: "en_bodega_central", via: "deshacer_asignacion", callSite: "deshacerAsignacionLote (149, caso b)" },
  { n: "46", origen: "mensajero_recogiendo_en_bodega", destino: "en_bodega_central", via: "deshacer_asignacion", callSite: "DeshacerAsignacionService.deshacer -> OrdenRepository.deshacerAsignacionLote (149, caso a central)" },
  { n: "47", origen: "mensajero_recogiendo_en_bodega", destino: "en_bodega_satelite", via: "deshacer_asignacion", callSite: "deshacerAsignacionLote (149, caso a satelite)" },
  // Feature 158, PR 1 (Q-D, 2026-07-30): DESHACER un `incidente` del mensajero. Es un par
  // NUEVO, asi que sube tanto el recuento de aristas (41 -> 42) como el de pares unicos
  // (39 -> 40).
  //
  // NUMERACION: el PR 1 salto del #47 al #53 A PROPOSITO, reservando #48-#52 y #54-#58 para el
  // camino del ADMIN, que no tenia productor todavia (design §15.2). El PR 2 los ocupa, abajo.
  { n: "53", origen: "incidente", destino: "en_reparto", via: "deshacer_gestion", callSite: "CierreDiaService.deshacerGestion -> CierreDiaRepository.anularGestionYDevolverAGestion (158)" },
  // FICHA 454 (2026-09-23): #60 (anclaje) y #61 (deshacer), las dos salidas del pre-estado de la
  // 239, quedan RETIRADAS con su estado. El anclaje lo hereda #70; el deshacer de una gestion
  // pendiente ya no transiciona (anula + evento `gestion_anulada`).
  // Feature 158, PR 2 — camino del ADMIN. CINCO entradas desde el conjunto CERRADO de origenes
  // que el humano fijo (Q-A) y sus CINCO inversas de reversion. Las diez son pares NUEVOS, asi
  // que suben por igual los dos recuentos (42 -> 52 y 40 -> 50). El `rol` de cada una esta
  // calcado de sus vecinas del MISMO origen (design §12.3), no inventado.
  { n: "48", origen: "en_bodega_central", destino: "incidente", via: "incidente", callSite: "IncidenteAdminService.reportar -> IncidenteAdminRepository.reportar (158)" },
  { n: "49", origen: "en_bodega_satelite", destino: "incidente", via: "incidente", callSite: "IncidenteAdminRepository.reportar (158)" },
  { n: "50", origen: "en_ruta_bodega_central", destino: "incidente", via: "incidente", callSite: "IncidenteAdminRepository.reportar (158)" },
  { n: "51", origen: "en_ruta_bodega_satelite", destino: "incidente", via: "incidente", callSite: "IncidenteAdminRepository.reportar (158)" },
  { n: "52", origen: "mensajero_recogiendo_en_bodega", destino: "incidente", via: "incidente", callSite: "IncidenteAdminRepository.reportar (158; Q-K: NO toca mensajero_asignado_id)" },
  // Las cinco inversas. El destino de cada reversion se DERIVA del historial
  // (`findOrigenesReversion`, 149) y se valida contra el conjunto cerrado de los 5 origenes: no
  // hay destino fijo escrito en el codigo (R57/R58).
  { n: "54", origen: "incidente", destino: "en_bodega_central", via: "incidente", callSite: "IncidenteAdminService.rechazar/retractar -> IncidenteAdminRepository.resolver (158)" },
  { n: "55", origen: "incidente", destino: "en_bodega_satelite", via: "incidente", callSite: "IncidenteAdminRepository.resolver (158)" },
  { n: "56", origen: "incidente", destino: "en_ruta_bodega_central", via: "incidente", callSite: "IncidenteAdminRepository.resolver (158)" },
  { n: "57", origen: "incidente", destino: "en_ruta_bodega_satelite", via: "incidente", callSite: "IncidenteAdminRepository.resolver (158)" },
  { n: "58", origen: "incidente", destino: "mensajero_recogiendo_en_bodega", via: "incidente", callSite: "IncidenteAdminRepository.resolver (158)" },
  // FICHA 454 (2026-09-23): #62-#66, la ayuda a la tienda como ESTADO (235: #62 solicitud, #63
  // rescate, #64 corte; 237: #65/#66 gestion de la tienda), quedan RETIRADAS con el estado. La ayuda
  // es un evento (`orden_evento`) sobre una orden que sigue `en_reparto`; el corte la barre por #16
  // y la gestion de la tienda se aplica al aprobar por #71/#72 (abajo).
  // Feature 240 (2026-08-20) — EL RECHAZO MANUAL DE LA TIENDA. A diferencia de las tres altas
  // anteriores, esta NO es un par nuevo: `devuelta -> rechazada` YA estaba declarado por #21 (el
  // cron de plazo vencido). Es el TERCER duplicado historico del inventario, hermano exacto de
  // #19/#23 y #20/#24 — mismo par, familia distinta porque quien decide es otro—. Por eso
  // `aristasFlujo` sube y `paresUnicos` NO (ver el recuento).
  //
  // NO se retira #21: el cron sigue escalando por su cuenta las devoluciones que nadie resuelve.
  // Las dos vias conviven y la carrera entre ellas la cierra la guarda del `updateMany` (quien
  // llegue segundo obtiene count = 0 y no deja efectos), no una exclusion en el grafo.
  { n: "67", origen: "novedad", destino: "devolucion_a_origen_por_rechazo", via: "rechazo_tienda", callSite: "RechazoTiendaService.rechazar -> GestionOrdenRepository.rechazarDesdeDevuelta (240)" },
  // FICHA 454 (2026-09-23, design §2) — ALTA de `en_reparto -> devuelta` con familia
  // `anclaje_devolucion`. Es el PAR de la vieja #14 (retirada por la 239), pero NO la reabre: la #14
  // era la gestion del mensajero llevando a `devuelta` al instante; esta la produce SOLO la
  // aprobacion del cierre, que es lo que la 239 pedia. Par NUEVO en el inventario vigente.
  //
  // Las BAJAS de la 454 (#59-#66 y las dos claves de los estados retirados) viajan con el retiro de
  // los dos values del catalogo (fase 2 de la 454, 2026-09-23).
  { n: "70", origen: "en_reparto", destino: "novedad", via: "anclaje_devolucion", callSite: "CierresAdminRepository.resolverCierre, bloque APLICACION DE GESTIONES (454)" },
  // FICHA 454 (2026-09-23, design §2) — METADATO de la gestion de la TIENDA desde una ayuda abierta
  // (237), que ahora se aplica desde `en_reparto` al aprobar el cierre, con familia
  // `gestion_tienda_ayuda`. Mismo par que #13/#15: suman arista y NO suman par.
  { n: "71", origen: "en_reparto", destino: "reprogramado", via: "gestion_tienda_ayuda", callSite: "CierresAdminRepository.resolverCierre, bloque APLICACION DE GESTIONES (454; gestion registrada por GestionDesdeAyudaService)" },
  { n: "72", origen: "en_reparto", destino: "devolucion_a_origen_por_rechazo", via: "gestion_tienda_ayuda", callSite: "CierresAdminRepository.resolverCierre, bloque APLICACION DE GESTIONES (454; gestion registrada por GestionDesdeAyudaService)" },
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
 * Recuentos: 52 aristas de flujo, 50 pares dirigidos unicos y 2 de creacion.
 *
 * CADENA COMPLETA, para que nadie tenga que reconstruirla:
 *   - la 156 dejo 42 aristas / 39 pares (retiro #4/#6/#7c);
 *   - la 155 bajo a 38 / 36: -4 aristas (#1/#2/#3/#7b) y -3 pares, porque los tres pares que
 *     salian del estado retirado desaparecen enteros — `-> por_recoger` (#1),
 *     `-> en_bodega_central` (#2) y `-> en_ruta_bodega_satelite` (#3 y #7b, que compartian par).
 *     Las de creacion bajaron de 4 a 2;
 *   - la 149 suma sus TRES aristas (#45/#46/#47) y las tres son pares NUEVOS, asi que suben
 *     ambos recuentos por igual: 38 -> 41 aristas y 36 -> 39 pares;
 *   - la 158 (PR 1, mensajero) suma UNA (#53, `incidente -> en_reparto`), tambien par NUEVO:
 *     41 -> 42 y 39 -> 40. Ademas REALINEA el `via` de #44 (`gestion` -> `incidente`), que no
 *     mueve ningun recuento;
 *   - la 158 (PR 2, admin) suma DIEZ (#48-#52 y #54-#58), las diez pares NUEVOS: 42 -> 52 y
 *     40 -> 50. Es el PENDIENTE que el PR 1 dejo DECLARADO aqui mismo, ya cobrado.
 *
 * Los 52 - 50 = 2 duplicados que quedan son #19/#23 y #20/#24 (SLA vs. recuperacion manual). El
 * tercer duplicado historico (#3/#7b) se fue con el estado de fulfillment. Ninguna de las diez
 * aristas del camino del admin repite un par ya declarado, por eso la diferencia no se mueve.
 *
 * ⏳ 2026-08-20 (feature 240): la frase de arriba —«los 2 duplicados que quedan»— vale hasta la
 * 237 incluida. La 240 anade un TERCERO, #21/#67, y la diferencia `aristas - pares` pasa de 2 a 3.
 * Ver la nota de `paresUnicos`.
 */
export const RECUENTO_INVENTARIO = {
  // 2026-08-19 (feature 239): 54 -> 56. Suma TRES (#59/#60/#61) y RETIRA UNA (#14).
  // 2026-08-19 (feature 235): 56 -> 59. Suma TRES (#62/#63/#64) y NO retira NINGUNA.
  // 2026-08-20 (feature 237): 59 -> 61. Suma DOS (#65/#66) y NO retira NINGUNA.
  // 2026-08-20 (feature 240): 61 -> 62. Suma UNA (#67) y NO retira NINGUNA.
  // 2026-08-24 (feature 276): 62 -> 63. Suma UNA (#68) y NO retira ninguna.
  // 2026-09-08 (ficha 398): 63 -> 64. Suma UNA (#69) y NO retira ninguna.
  // 2026-09-23 (ficha 454): 64 -> 65. Suma UNA (#70); sus bajas van con el retiro del catalogo.
  // 2026-09-23 (ficha 454, retiro del catalogo): 65 -> 59. RETIRA OCHO (#59-#66: las aristas de los
  // dos estados retirados) y suma DOS de metadato (#71/#72, `gestion_tienda_ayuda` desde `en_reparto`).
  aristasFlujo: 59, // +2 (157); +3 -1 (239); +3 (235); +2 (237); +1 (240); +1 (276); +1 (398); +1 -8 +2 (454)
  // 52 -> 54 (239) -> 57 (235) -> 59 (237): las dos altas de la 237 son pares NUEVOS
  // (`ayuda_tienda -> reprogramada` y `ayuda_tienda -> rechazada`; ninguno estaba declarado, y
  // hasta la 237 de `ayuda_tienda` solo se salia rescatando o por el corte), igual que las tres de
  // la 235. Asi que la aritmetica de pares sigue a la de aristas y la diferencia aristas - pares
  // se queda en 2 (los duplicados historicos #19/#23 y #20/#24). Los dos pares nuevos comparten
  // `via` entre si, pero eso no los hace duplicados: lo que cuenta un par es origen -> destino.
  //
  // 2026-08-20 (feature 240): 59 -> 59, SIN CAMBIO, y aqui la aritmetica DEJA de seguir a la de
  // aristas por primera vez desde la 158. La arista #67 (`devuelta -> rechazada` por la tienda)
  // repite un par que #21 (el cron de plazo vencido) YA tenia declarado, asi que suma arista y no
  // suma par. Con eso la diferencia `aristas - pares` pasa de 2 a **3** y los duplicados vigentes
  // son TRES: #19/#23, #20/#24 y #21/#67. Los tres son el mismo patron —el mismo movimiento de
  // estado producido por dos actores distintos, el sistema y una persona— y en los tres lo que los
  // separa es la FAMILIA, que es justo lo que hace falta para poder responder despues «¿quien
  // decidio esto?» sin adivinarlo por el par de estatus.
  // 2026-08-24 (feature 276): 59 -> 60. La arista #68 (`sin_gestionar -> rechazada`) es un par
  // NUEVO —de `sin_gestionar` solo se salia a las dos bodegas—, asi que la aritmetica de pares
  // vuelve a seguir a la de aristas y la diferencia `aristas - pares` se queda en 3 (los
  // duplicados #19/#23, #20/#24 y #21/#67).
  // 2026-09-08 (ficha 398): 60 -> 61. La arista #69 (`entregada -> rechazada`) es un par NUEVO —de
  // `entregada` solo se salia deshaciendo la gestion—, asi que la aritmetica de pares sigue a la de
  // aristas y la diferencia `aristas - pares` se queda en 3 (los duplicados #19/#23, #20/#24 y
  // #21/#67).
  // 2026-09-23 (ficha 454): 61 -> 62. La arista #70 (`en_reparto -> devuelta`) es un par NUEVO en
  // el inventario vigente (su gemela #14 la retiro la 239), asi que la diferencia se queda en 3.
  // 2026-09-23 (ficha 454, retiro del catalogo): 62 -> 54. Las OCHO aristas retiradas eran OCHO
  // pares distintos (todos tocaban un estado retirado). #71/#72 repiten los pares de #13/#15, asi
  // que no suman par: la diferencia `aristas - pares` pasa de 3 a 5 (#19/#23, #20/#24, #21/#67,
  // #13/#71 y #15/#72).
  paresUnicos: 54,
  aristasCreacion: 2,
} as const;
