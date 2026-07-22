import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 99 (design §6, R15/D3) — POLITICA de eventos publicos: los estados del ciclo de
// vida de la orden que el integrador consume. Constante UNICA (fuente de verdad); tanto el
// emisor (filtra las transiciones antes de encolar) como cualquier consumidor la referencian
// desde aqui, sin listas duplicadas.
//
// Se INCLUYEN los estados relevantes al integrador y se EXCLUYEN los internos de
// fulfillment/ruteo satelite que no consume (`en_fulfillment`, `en_preparacion`,
// `en_espera_aceptacion`, `en_ruta_bodega_satelite`, `en_bodega_satelite`). Lista FIJADA en
// el gate F1.4 (D3): cambiarla es cambiar el contrato publico de la feature.
export const EVENTOS_PUBLICOS: ReadonlySet<OrderStatusValue> = new Set<OrderStatusValue>([
  "en_ruta_bodega_principal",
  "en_bodega",
  "en_reparto",
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "devuelta_origen",
  "recibido_origen",
]);

/** `true` si el valor de estado destino es un evento publico emitible (R15). */
export function esEventoPublico(estado: string): boolean {
  return EVENTOS_PUBLICOS.has(estado as OrderStatusValue);
}
