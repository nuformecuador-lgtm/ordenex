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
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_SEED)[number];
