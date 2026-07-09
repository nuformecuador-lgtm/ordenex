// Fuente unica de verdad de los estatus de orden (R2), patron ROLES_SEED.
// El seed idempotente (seedOrderStatus) itera esta lista con upsert por `value`.
export const ORDER_STATUS_SEED = [
  "entregada",
  "devuelta",
  "devuelta_origen",
  "reprogramada",
  "embalaje",
  "en_ruta_bodega_principal",
  "en_bodega",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_SEED)[number];
