import { cn } from "@/lib/utils";
import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * Mapa de estatus de orden -> etiqueta legible + clases de color (fase 2
 * rebrand). Se reusa en cualquier lugar donde haya que mostrar un estatus con
 * el mismo look & feel. Los pares bg/texto están pensados para AA en light Y
 * dark (dark usa `/15` de opacidad sobre el color base + texto del color
 * base, técnica estándar de "soft badge").
 */
export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  en_preparacion: "En preparación",
  en_fulfillment: "En fulfillment",
  en_bodega: "En bodega",
  en_ruta_bodega_principal: "En ruta a bodega",
  entregada: "Entregada",
  devuelta: "Devuelta",
  devuelta_origen: "En ruta a origen",
  reprogramada: "Reprogramada",
  en_espera_aceptacion: "En espera de aceptación del mensajero", // feature 17
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30
  en_reparto: "En reparto", // feature 36
  rechazada: "Rechazada", // feature 36
  en_bodega_satelite: "En bodega satélite", // feature 33 (R9: la UI puede derivar la zona)
  recibido_origen: "Recibido en tienda", // cierre del flujo de devolución: la tienda de origen la recibió
};

const ORDER_STATUS_CLASSES: Record<OrderStatusValue, string> = {
  en_preparacion:
    "bg-asfalto-1 text-asfalto-7 dark:bg-asfalto-7/20 dark:text-asfalto-2",
  en_fulfillment:
    "bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light",
  en_bodega: "bg-asfalto-1 text-navy dark:bg-navy/20 dark:text-asfalto-2",
  en_ruta_bodega_principal:
    "bg-[#eff6ff] text-info dark:bg-info/15 dark:text-[#7fa8f5]",
  entregada:
    "bg-success-soft text-[#065f46] dark:bg-success/15 dark:text-success",
  devuelta:
    "bg-warning-soft text-[#92400e] dark:bg-warning/15 dark:text-warning",
  devuelta_origen:
    "bg-danger-soft text-[#991b1b] dark:bg-danger/15 dark:text-danger",
  reprogramada:
    "border border-hivis/60 bg-warning-soft text-[#92400e] dark:border-hivis/40 dark:bg-warning/15 dark:text-warning",
  en_espera_aceptacion:
    "bg-[#eff6ff] text-info dark:bg-info/15 dark:text-[#7fa8f5]", // feature 17
  en_ruta_bodega_satelite:
    "bg-[#eff6ff] text-info dark:bg-info/15 dark:text-[#7fa8f5]", // feature 30
  en_reparto:
    "bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light", // feature 36
  rechazada:
    "bg-danger-soft text-[#991b1b] dark:bg-danger/15 dark:text-danger", // feature 36
  en_bodega_satelite:
    "bg-[#eff6ff] text-info dark:bg-info/15 dark:text-[#7fa8f5]", // feature 33
  // Terminal y NO error: reusa el par de `entregada` (success), el otro cierre
  // sano del flujo. `devuelta_origen` sigue en danger por ser el tránsito.
  recibido_origen:
    "bg-success-soft text-[#065f46] dark:bg-success/15 dark:text-success",
};

const NEUTRAL_CLASSES =
  "bg-asfalto-1 text-asfalto-7 dark:bg-asfalto-7/20 dark:text-asfalto-2";

function isKnownStatus(value: string): value is OrderStatusValue {
  return value in ORDER_STATUS_LABELS;
}

/**
 * Chip de estatus de orden. Si `value` no matchea ningún estatus conocido, cae
 * a un chip neutro con el valor crudo (no rompe la UI ante datos inesperados).
 *
 * Feature 30/R15: para `en_ruta_bodega_satelite` el destino es la bodega de la
 * ZONA de la orden. Cuando el consumidor pasa `zonaNombre` (derivado por fila de
 * `orden.zonaId`), el label se vuelve legible como "En ruta a bodega <zona>"; sin
 * él, cae al label estático genérico (el único estado con nombre derivado; el
 * resto de estados ignora `zonaNombre`).
 */
export function EstatusBadge({
  value,
  zonaNombre,
}: {
  value: string;
  zonaNombre?: string;
}) {
  const known = isKnownStatus(value);
  const label =
    value === "en_ruta_bodega_satelite" && zonaNombre
      ? `En ruta a bodega ${zonaNombre}`
      : known
        ? ORDER_STATUS_LABELS[value]
        : value;
  const classes = known ? ORDER_STATUS_CLASSES[value] : NEUTRAL_CLASSES;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        classes,
      )}
    >
      {label}
    </span>
  );
}
