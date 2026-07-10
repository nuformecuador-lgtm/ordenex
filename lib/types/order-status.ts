// Fuente unica de verdad de los estatus de orden (R2), patron ROLES_SEED.
// El seed idempotente (seedOrderStatus) itera esta lista con upsert por `value`.
// Feature 15/R5: suma "en_preparacion" (8vo valor), nuevo default GLOBAL de
// creacion (ordenesConfig.DEFAULT_ESTATUS_VALUE, ver lib/config/ordenes.ts).
export const ORDER_STATUS_SEED = [
  "entregada",
  "devuelta",
  "devuelta_origen",
  "reprogramada",
  "embalaje",
  "en_ruta_bodega_principal",
  "en_bodega",
  "en_preparacion",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_SEED)[number];
