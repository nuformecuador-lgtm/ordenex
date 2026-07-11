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
  devuelta_origen: "Devuelta a origen",
  reprogramada: "Reprogramada",
  en_espera_aceptacion: "En espera de aceptación del mensajero", // feature 17
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
};

const NEUTRAL_CLASSES =
  "bg-asfalto-1 text-asfalto-7 dark:bg-asfalto-7/20 dark:text-asfalto-2";

function isKnownStatus(value: string): value is OrderStatusValue {
  return value in ORDER_STATUS_LABELS;
}

/**
 * Chip de estatus de orden. Si `value` no matchea ningún estatus conocido, cae
 * a un chip neutro con el valor crudo (no rompe la UI ante datos inesperados).
 */
export function EstatusBadge({ value }: { value: string }) {
  const known = isKnownStatus(value);
  const label = known ? ORDER_STATUS_LABELS[value] : value;
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
