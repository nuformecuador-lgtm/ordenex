import type { VariantProps } from "class-variance-authority";

import { EstadoConInfo } from "@/components/shared/EstadoInfo";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  esOrderStatusRetirado,
  NOMBRE_ESTADO,
  type OrderStatusValue,
} from "@/lib/types/order-status";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * FICHA 455 (2026-09-24, design DA; R1/R2/R42) — el nombre visible de cada estado ya NO se escribe
 * aquí: es `NOMBRE_ESTADO`, la fuente única de `lib/types/order-status.ts`. `ORDER_STATUS_LABELS` se
 * conserva como REEXPORTACIÓN (mismo objeto) para los consumidores que ya la importaban. Hasta la
 * 455 este archivo tenía su propio mapa («Entregada», «Por recoger», «Sin gestionar»…) y cada
 * superficie de `lib/` el suyo: por eso divergían.
 *
 * Las filas HISTÓRICAS de un estado retirado (454/155) ya no tienen mapa propio: `nombreDeEstado`
 * las lee como «<nombre histórico> (estado retirado)» (R11).
 */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatusValue, string>> = NOMBRE_ESTADO;

/**
 * Estatus -> variante semántica de la primitiva `Badge`. La semántica se conserva
 * (entregada/recibido = éxito, devolución/rechazo = alerta/peligro, tránsito = info).
 * Los estados operativos sin color semántico (bodega, preparación) usan la variante
 * neutra `secondary` y, si necesitan el acento de marca/navy, un `className` de
 * refuerzo con TOKENS (ver `ORDER_STATUS_CLASS`). Sin hex.
 */
const ORDER_STATUS_VARIANT: Record<OrderStatusValue, BadgeVariant> = {
  en_preparacion: "secondary",
  en_bodega_central: "secondary",
  en_ruta_bodega_central: "info",
  entregado: "success",
  novedad: "warning",
  devolviendo_a_tienda: "danger",
  reprogramado: "warning",
  mensajero_recogiendo_en_bodega: "info", // feature 17
  en_ruta_bodega_satelite: "info", // feature 30
  en_reparto: "secondary", // feature 36
  devolucion_a_origen_por_rechazo: "danger", // feature 36
  en_bodega_satelite: "info", // feature 33
  // Terminal y NO error: reusa la variante de `entregada` (success), el otro cierre
  // sano del flujo. `devolviendo_a_tienda` sigue en danger por ser el tránsito.
  devuelta_a_tienda: "success",
  // Feature 109/R25: estado de EXCEPCIÓN (orden sin gestionar, congelada) -> variante de alerta.
  novedad_interna: "warning",
  // Feature 139/R4: estados del flujo de devolución de rechazadas. Los estados de ESPERA
  // (por devolver / por devolver a tienda) usan `warning` (acción pendiente); el de TRÁNSITO
  // (devolviendo a bodega central) usa `info`, como el resto de estados en ruta.
  por_devolver_a_bodega_central: "warning",
  devolviendo_a_bodega_central: "info",
  por_devolver_a_tienda: "warning",
  // Feature 154/R29/R30 (Q5 confirmada por el humano). Mismo criterio que los estados ya
  // clasificados: `por_recolectar_en_tienda` es un estado de ESPERA (acción pendiente) ->
  // `warning`, igual que `por_devolver`; `incidente` es un cierre en error -> `danger`, igual
  // que `rechazada`. Ninguno lleva refuerzo de acento de marca en `ORDER_STATUS_CLASS`.
  por_recolectar_en_tienda: "warning",
  // Feature 157: ya hay alguien yendo, asi que NO es una espera sin dueño como el anterior:
  // es trabajo en curso, la misma familia visual que el resto de tramos en movimiento.
  recolectando: "info",
  incidente: "danger",
  // FICHA 454 (R37): fuera las variantes de los dos estados retirados; sus filas históricas usan
  // `warning`, la que tenían (ver `EstatusBadge`).
};

/**
 * Refuerzo de acento (solo TOKENS QUE GIRAN CON EL TEMA) para los estados que sobre
 * la variante neutra conservan su color de marca o su borde hivis. Se combina sobre
 * la variante base vía `cn`/twMerge (la última clase gana).
 */
const ORDER_STATUS_CLASS: Partial<Record<OrderStatusValue, string>> = {
  // Feature 155/R28: se retira el refuerzo del estado de fulfillment en bodega junto
  // con el value. `en_reparto` queda como único portador de estos 4 tokens (era su
  // gemelo de presentación desde la 153).
  en_reparto:
    "bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light",
  // Feature 208: era `text-navy dark:bg-navy/20 dark:text-asfalto-2` — tres hex
  // fijos para decir "tinta y realce del tema". `foreground` hace lo mismo con un
  // solo token y en claro es el mismo azul (#12233f vs #0b2545).
  en_bodega_central: "text-foreground dark:bg-foreground/10",
  reprogramado: "border-hivis/60 dark:border-hivis/40",
};

function isKnownStatus(value: string): value is OrderStatusValue {
  return value in ORDER_STATUS_VARIANT;
}

/**
 * Chip de estatus de orden. El texto es SIEMPRE `nombreDeEstado(value)` (R2/R10/R11): el nombre
 * visible exacto; un estado retirado, «<histórico> (estado retirado)»; un código desconocido,
 * «Estado no reconocido» (nunca el código crudo, R3).
 *
 * FICHA 455 (2026-09-24, R2): se retira la derivación «En ruta a bodega <zona>» de la feature 30:
 * el nombre del estado no interpola ningún dato. La zona es columna propia en los listados.
 */
/*
 * FICHA 456 (T2.3, design §3; R9/R32) — el chip va SIEMPRE con su botón de información: se pinta
 * dentro de `EstadoConInfo`, que calcula el nombre y pone el botón como HERMANO del `Badge`. El
 * `Badge` conserva texto, variante y clases (R32). Sin prop para apagarlo (design §10-I): sus
 * consumidores —`/ordenes`, el detalle del día de `/monitoreo`, la bodega satélite, la carga
 * masiva— lo heredan. Un retirado o desconocido sale sin botón (R15).
 */
export function EstatusBadge({ value }: { value: string }) {
  const known = isKnownStatus(value);
  // Estado retirado por la 454 (fila histórica, R40) -> la variante `warning` que tenían; el de la
  // 155 y cualquier desconocido -> variante neutra (no rompe la UI ante datos inesperados).
  const variant = known
    ? ORDER_STATUS_VARIANT[value]
    : esOrderStatusRetirado(value)
      ? "warning"
      : "secondary";
  const extra = known ? ORDER_STATUS_CLASS[value] : undefined;

  return (
    <EstadoConInfo
      codigo={value}
      chip={(nombre) => (
        <Badge variant={variant} className={cn(extra)}>
          {nombre}
        </Badge>
      )}
    />
  );
}
