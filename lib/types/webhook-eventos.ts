import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 99 (design §6, R15/D3) — POLITICA de eventos publicos: los estados del ciclo de
// vida de la orden que el integrador consume. Constante UNICA (fuente de verdad); tanto el
// emisor (filtra las transiciones antes de encolar) como cualquier consumidor la referencian
// desde aqui, sin listas duplicadas.
//
// Se INCLUYEN los estados relevantes al integrador y se EXCLUYEN los internos de
// preparacion/ruteo satelite que no consume (`en_preparacion`, `por_recoger`,
// `en_ruta_bodega_satelite`, `en_bodega_satelite`). Lista FIJADA en el gate F1.4 (D3):
// cambiarla es cambiar el contrato publico de la feature.
//
// FEATURE 155/R43 (decision del humano en la puerta T0.1, 2026-07-29) — AMPLIACION ADITIVA:
// entra `por_recolectar_en_tienda`. Hasta la 155 una orden creada por API key nacia en
// `en_ruta_bodega_central`, que SI esta en esta lista, asi que el integrador recibia un evento
// al crearla. Tras la bifurcacion nace en `por_recolectar_en_tienda`: sin este alta, ese
// integrador dejaria de recibir CUALQUIER cosa hasta que la orden llegue a la bodega central,
// y el silencio se leeria como "no se creo". El cambio es estrictamente aditivo: ningun estado
// que hoy emite evento deja de emitirlo.
export const EVENTOS_PUBLICOS: ReadonlySet<OrderStatusValue> = new Set<OrderStatusValue>([
  "por_recolectar_en_tienda", // feature 155/R43: evento de NACIMIENTO de la rama (b)
  "en_ruta_bodega_central",
  "en_bodega_central",
  "en_reparto",
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "devolviendo_a_tienda",
  "devuelta_a_tienda",
]);

/** `true` si el valor de estado destino es un evento publico emitible (R15). */
export function esEventoPublico(estado: string): boolean {
  return EVENTOS_PUBLICOS.has(estado as OrderStatusValue);
}
