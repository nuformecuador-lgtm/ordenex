// Fuente unica de verdad de los estatus de orden (R2), patron ROLES_SEED.
// El seed idempotente (seedOrderStatus) itera esta lista con upsert por `value`.
// Feature 15/R5: suma "en_preparacion" (8vo valor), nuevo default GLOBAL de
// creacion (ordenesConfig.DEFAULT_ESTATUS_VALUE, ver lib/config/ordenes.ts).
// Feature 17/R9: suma "por_recoger" (9no valor) — la orden ya tiene
// num_guia y mensajero_asignado_id pero espera que el mensajero la acepte
// (feature 36 modela esa respuesta).
// Feature 30/R1: suma "en_ruta_bodega_satelite" (10mo valor) — orden no-GAM
// ruteada hacia la bodega satelite de su zona (nombre de zona derivado de
// orden.zonaId para el display, R15/R20). Recibe num_guia en el ruteo (R10).
// Feature 36/R1/R3 (decision F1.4-a,b): suma dos valores del flujo del mensajero:
// "en_reparto" (11mo) — la orden fue RECOGIDA por el mensajero (transiciona desde
// por_recoger al pulsar "Recoger") y sale a reparto; "rechazada" (12mo)
// — resultado RECHAZO de la gestion (NO se mapea a devuelta/devolviendo_a_tienda,
// que pertenecen a los flujos 47/48). Sembrados idempotentemente por seedOrderStatus.
// Feature 33/R1: suma "en_bodega_satelite" (13mo valor) — la orden ruteada a la
// satelite (feature 30, en_ruta_bodega_satelite) es RECIBIDA por el adminSatelite
// al escanear su QR (nombre de zona derivado de orden.zonaId para el display, R9).
// Feature 135/R1/R5: rename de nomenclatura de 6 values (conservando su POSICION,
// indices 5/6/8/10/13 y el 2). El mapeo antiguo->nuevo y su reversion viven en la
// migracion nueva 20260724120000_order_status_rename_nomenclatura (UPDATE sobre la
// tabla catalogo order_status: id/FK preservados, R4); los otros 9 values no cambian.
// Feature 139/R1: suma los TRES estados del flujo de DEVOLUCION de rechazadas
// (indices 15/16/17, APENDICE sin alterar posiciones previas): "por_devolver" (satelite
// tras aprobar el cierre, elegible para "enviar a central"), "devolviendo_a_bodega_central"
// (en transito satelite->central) y "por_devolver_a_tienda" (en la central, elegible para
// "enviar a la tienda"). Sembrados idempotentemente por seedOrderStatus + migracion
// 20260724140000_order_status_devolucion_rechazadas (INSERT ... WHERE NOT EXISTS por value).
// Feature 153/R1: rename MECANICO de UN solo value, conservando su POSICION (indice 10):
// el 11mo value vuelve a llamarse "en_reparto" y su etiqueta UI pasa a ser "En reparto".
// Revierte, solo para ese value, el rename que hizo la 135; el resto de la nomenclatura
// queda igual. Sin cambio de flujo: mismas aristas, mismos id, mismas FKs. La migracion es
// un UPDATE sobre la tabla catalogo order_status (20260728120000_order_status_en_reparto).
// OJO: los vecinos "en_ruta_bodega_central" y "en_ruta_bodega_satelite" NO se tocan
// (ni value ni etiqueta); el censo del guard usa frontera de palabra por eso.
// Feature 154/R1/R2/R3: suma los DOS values del flujo v2 como APENDICE (indices 18/19), sin
// renombrar, reordenar ni borrar ninguno de los 18 previos -> el catalogo pasa a 20.
// "por_recolectar_en_tienda" (19no value): la orden nace en la tienda y espera que el mensajero
// la RECOLECTE ahi; "incidente" (20mo value): resultado TERMINAL de la gestion. Sembrados
// idempotentemente por seedOrderStatus + la migracion
// 20260729120000_order_status_v2_por_recolectar_incidente (INSERT ... WHERE NOT EXISTS por value).
// La 154 es SOLO ADITIVA (decision Q2 del gate, 2026-07-29): DECLARA los values y sus aristas,
// pero ningun service los produce todavia — eso llega con las features 155/157/158.
export const ORDER_STATUS_SEED = [
  "entregada",
  "devuelta",
  "devolviendo_a_tienda", // feature 135 (antes en el flujo de devolucion)
  "reprogramada",
  "en_fulfillment",
  "en_ruta_bodega_central", // feature 135
  "en_bodega_central", // feature 135
  "en_preparacion",
  "por_recoger", // feature 17 (renombrado en feature 135)
  "en_ruta_bodega_satelite", // feature 30
  "en_reparto", // feature 36: recogida por el mensajero / en reparto (renombrado en feature 135 y en la 153)
  "rechazada", // feature 36: resultado RECHAZO de la gestion
  "en_bodega_satelite", // feature 33: recibida en la bodega satelite de su zona
  "devuelta_a_tienda", // 14mo valor: cierre del flujo de devolucion, la tienda de origen la recibio (renombrado en feature 135)
  "sin_gestionar", // feature 109 (15mo valor): orden que quedo en en_reparto al pasar de dia; el corte la congela y bloquea al mensajero via un cierre `vencido` hasta que se APRUEBE
  "por_devolver", // feature 139 (16mo valor): rechazada de bodega satelite tras APROBAR el cierre; el adminSatelite la envia a la central (por lote)
  "devolviendo_a_bodega_central", // feature 139 (17mo valor): en transito satelite -> central (tras "enviar a central")
  "por_devolver_a_tienda", // feature 139 (18mo valor): en la central (llego por cierre central directo o por recepcion central); maestro/admin la envia a la tienda (por lote)
  "por_recolectar_en_tienda", // feature 154 (19no valor): estado de ESPERA en la tienda; el mensajero la recolecta y sale hacia en_ruta_bodega_central (#43, feature 157)
  "incidente", // feature 154 (20mo valor): resultado TERMINAL de la gestion del mensajero (#44, feature 158). Sin aristas de salida (decision del gate 2026-07-29)
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_SEED)[number];

// Feature 63/A1 (R1-R4): resultado tipado y discriminado de la Server Action
// `listarOrderStatus()`. Espeja el patron de resultados de dominio del repo
// (union con `status`): el borde no filtra internals ni PII, solo el catalogo
// liviano (`id`/`value`, R1). Import type-only (sin costo en runtime del seed).
// - `ok`: catalogo completo (R1/R2); el orden determinista lo garantiza el repo (R5).
// - `unauthenticated`: sin sesion valida (R3), sin datos.
// - `forbidden`: rol `mensajero` u otro no reconocido (R4), sin datos.
export type ListarOrderStatusResult =
  | { status: "ok"; estatus: import("@/lib/interfaces/repositories/IOrdenRepository").OrderStatusLiteRow[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
