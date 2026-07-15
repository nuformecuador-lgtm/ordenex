// Fuente unica de verdad de los estatus de orden (R2), patron ROLES_SEED.
// El seed idempotente (seedOrderStatus) itera esta lista con upsert por `value`.
// Feature 15/R5: suma "en_preparacion" (8vo valor), nuevo default GLOBAL de
// creacion (ordenesConfig.DEFAULT_ESTATUS_VALUE, ver lib/config/ordenes.ts).
// Feature 17/R9: suma "en_espera_aceptacion" (9no valor) — la orden ya tiene
// num_guia y mensajero_asignado_id pero espera que el mensajero la acepte
// (feature 36 modela esa respuesta).
// Feature 30/R1: suma "en_ruta_bodega_satelite" (10mo valor) — orden no-GAM
// ruteada hacia la bodega satelite de su zona (nombre de zona derivado de
// orden.zonaId para el display, R15/R20). Recibe num_guia en el ruteo (R10).
// Feature 36/R1/R3 (decision F1.4-a,b): suma dos valores del flujo del mensajero:
// "en_reparto" (11mo) — la orden fue RECOGIDA por el mensajero (transiciona desde
// en_espera_aceptacion al pulsar "Recoger") y sale a reparto; "rechazada" (12mo)
// — resultado RECHAZO de la gestion (NO se mapea a devuelta/devuelta_origen, que
// pertenecen a los flujos 47/48). Sembrados idempotentemente por seedOrderStatus.
// Feature 33/R1: suma "en_bodega_satelite" (13mo valor) — la orden ruteada a la
// satelite (feature 30, en_ruta_bodega_satelite) es RECIBIDA por el adminSatelite
// al escanear su QR (nombre de zona derivado de orden.zonaId para el display, R9).
export const ORDER_STATUS_SEED = [
  "entregada",
  "devuelta",
  "devuelta_origen",
  "reprogramada",
  "en_fulfillment",
  "en_ruta_bodega_principal",
  "en_bodega",
  "en_preparacion",
  "en_espera_aceptacion", // feature 17
  "en_ruta_bodega_satelite", // feature 30
  "en_reparto", // feature 36: recogida por el mensajero / en reparto
  "rechazada", // feature 36: resultado RECHAZO de la gestion
  "en_bodega_satelite", // feature 33: recibida en la bodega satelite de su zona
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
