// Feature 29 — Mapa de presentación (frontend) value → label del estatus de una
// orden (R17, design D5). Las claves se anclan a `ORDER_STATUS_SEED` mediante un
// `Record` tipado: añadir/quitar un status rompe el build (no silencioso).
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

const ESTATUS_LABELS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregada: "Entregada",
  devuelta: "Devuelta",
  devuelta_origen: "En ruta a origen",
  reprogramada: "Reprogramada",
  en_fulfillment: "En fulfillment",
  en_ruta_bodega_principal: "En ruta a bodega principal",
  en_bodega: "En bodega",
  en_preparacion: "En preparación",
  en_espera_aceptacion: "Por recoger", // feature 17/36 (R4/R33): esperando a que el mensajero la recoja
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30 (R15: la UI puede derivar la zona)
  en_reparto: "En reparto", // feature 36/R4: recogida por el mensajero
  rechazada: "Rechazada", // feature 36/R4: resultado RECHAZO
  en_bodega_satelite: "En bodega satélite", // feature 33 (R9: la UI deriva la zona de orden.zonaId)
  recibido_origen: "Recibido en tienda", // cierre del flujo de devolución: la tienda de origen la recibió
};

/**
 * Etiqueta legible en español para un `value` de estatus. Fallback (R17):
 * `value` desconocido → se muestra el `value` crudo; `null`/vacío → "—".
 */
export function estatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (ESTATUS_LABELS as Record<string, string>)[value] ?? value;
}
