import type { VariantProps } from "class-variance-authority";

import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OrderStatusValue } from "@/lib/types/order-status";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * Mapa de estatus de orden -> etiqueta legible. Se reusa en cualquier lugar
 * donde haya que mostrar un estatus con el mismo look & feel.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  en_preparacion: "En preparación",
  en_fulfillment: "En fulfillment",
  en_bodega: "En B. Central",
  en_ruta_bodega_principal: "Enviando a B. Central",
  entregada: "Entregada",
  devuelta: "Devuelta",
  devuelta_origen: "Devolviendo a tienda",
  reprogramada: "Reprogramada",
  en_espera_aceptacion: "Por recoger", // feature 17
  en_ruta_bodega_satelite: "Por recibir en satélite", // feature 30
  en_reparto: "En ruta", // feature 36
  rechazada: "Rechazada", // feature 36
  en_bodega_satelite: "En satélite", // feature 33 (R9: la UI puede derivar la zona)
  recibido_origen: "En tienda", // cierre del flujo de devolución: la tienda de origen la recibió
  sin_gestionar: "Sin gestionar", // feature 109/R25: orden que quedó en reparto al pasar de día (congelada hasta aprobar el cierre)
};

/**
 * Estatus -> variante semántica de la primitiva `Badge`. La semántica se conserva
 * (entregada/recibido = éxito, devolución/rechazo = alerta/peligro, tránsito = info).
 * Los estados operativos sin color semántico (fulfillment, bodega, preparación) usan
 * la variante neutra `secondary` y, si necesitan el acento de marca/navy, un
 * `className` de refuerzo con TOKENS (ver `ORDER_STATUS_CLASS`). Sin hex.
 */
const ORDER_STATUS_VARIANT: Record<OrderStatusValue, BadgeVariant> = {
  en_preparacion: "secondary",
  en_fulfillment: "secondary",
  en_bodega: "secondary",
  en_ruta_bodega_principal: "info",
  entregada: "success",
  devuelta: "warning",
  devuelta_origen: "danger",
  reprogramada: "warning",
  en_espera_aceptacion: "info", // feature 17
  en_ruta_bodega_satelite: "info", // feature 30
  en_reparto: "secondary", // feature 36
  rechazada: "danger", // feature 36
  en_bodega_satelite: "info", // feature 33
  // Terminal y NO error: reusa la variante de `entregada` (success), el otro cierre
  // sano del flujo. `devuelta_origen` sigue en danger por ser el tránsito.
  recibido_origen: "success",
  // Feature 109/R25: estado de EXCEPCIÓN (orden sin gestionar, congelada) -> variante de alerta.
  sin_gestionar: "warning",
};

/**
 * Refuerzo de acento (solo TOKENS) para los estados que sobre la variante neutra
 * conservan su color de marca/navy o su borde hivis. Se combina sobre la variante
 * base vía `cn`/twMerge (la última clase gana).
 */
const ORDER_STATUS_CLASS: Partial<Record<OrderStatusValue, string>> = {
  en_fulfillment:
    "bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light",
  en_reparto:
    "bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light",
  en_bodega: "text-navy dark:bg-navy/20 dark:text-asfalto-2",
  reprogramada: "border-hivis/60 dark:border-hivis/40",
};

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
  // Estatus desconocido -> variante neutra (no rompe la UI ante datos inesperados).
  const variant = known ? ORDER_STATUS_VARIANT[value] : "secondary";
  const extra = known ? ORDER_STATUS_CLASS[value] : undefined;

  return <Badge variant={variant} className={cn(extra)}>{label}</Badge>;
}
