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
  en_bodega_central: "En bodega central", // feature 135 (R8): value legible directo
  en_ruta_bodega_central: "En ruta a bodega central", // feature 135 (R8)
  entregada: "Entregada",
  devuelta: "Devuelta",
  devolviendo_a_tienda: "Devolviendo a tienda", // feature 135
  reprogramada: "Reprogramada",
  por_recoger: "Por recoger", // feature 17 (renombrado en feature 135)
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30 (R8: value legible directo)
  en_reparto: "En reparto", // feature 36 (renombrado en la 135 y de vuelta en la 153/R9)
  rechazada: "Rechazada", // feature 36
  en_bodega_satelite: "En bodega satélite", // feature 33 (R8: value legible directo)
  devuelta_a_tienda: "Devuelta a tienda", // feature 135: cierre del flujo de devolución, la tienda de origen la recibió
  sin_gestionar: "Sin gestionar", // feature 109/R25: orden que quedó en en_reparto al pasar de día (congelada hasta aprobar el cierre)
  por_devolver: "Por devolver", // feature 139/R4: rechazada de bodega satélite tras aprobar el cierre (elegible para "enviar a central")
  devolviendo_a_bodega_central: "Devolviendo a bodega central", // feature 139/R4: en tránsito satélite → central
  por_devolver_a_tienda: "Por devolver a tienda", // feature 139/R4: en la central, elegible para "enviar a la tienda"
  por_recolectar_en_tienda: "Por recolectar en tienda", // feature 154/R29: espera en la tienda a que el mensajero la recolecte
  incidente: "Incidente", // feature 154/R30: resultado terminal de la gestión
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
  en_bodega_central: "secondary",
  en_ruta_bodega_central: "info",
  entregada: "success",
  devuelta: "warning",
  devolviendo_a_tienda: "danger",
  reprogramada: "warning",
  por_recoger: "info", // feature 17
  en_ruta_bodega_satelite: "info", // feature 30
  en_reparto: "secondary", // feature 36
  rechazada: "danger", // feature 36
  en_bodega_satelite: "info", // feature 33
  // Terminal y NO error: reusa la variante de `entregada` (success), el otro cierre
  // sano del flujo. `devolviendo_a_tienda` sigue en danger por ser el tránsito.
  devuelta_a_tienda: "success",
  // Feature 109/R25: estado de EXCEPCIÓN (orden sin gestionar, congelada) -> variante de alerta.
  sin_gestionar: "warning",
  // Feature 139/R4: estados del flujo de devolución de rechazadas. Los estados de ESPERA
  // (por devolver / por devolver a tienda) usan `warning` (acción pendiente); el de TRÁNSITO
  // (devolviendo a bodega central) usa `info`, como el resto de estados en ruta.
  por_devolver: "warning",
  devolviendo_a_bodega_central: "info",
  por_devolver_a_tienda: "warning",
  // Feature 154/R29/R30 (Q5 confirmada por el humano). Mismo criterio que los estados ya
  // clasificados: `por_recolectar_en_tienda` es un estado de ESPERA (acción pendiente) ->
  // `warning`, igual que `por_devolver`; `incidente` es un cierre en error -> `danger`, igual
  // que `rechazada`. Ninguno lleva refuerzo de acento de marca en `ORDER_STATUS_CLASS`.
  por_recolectar_en_tienda: "warning",
  incidente: "danger",
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
  en_bodega_central: "text-navy dark:bg-navy/20 dark:text-asfalto-2",
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
