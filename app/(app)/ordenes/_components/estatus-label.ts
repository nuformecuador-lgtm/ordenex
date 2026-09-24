// Feature 29 — Mapa de presentación (frontend) value → label del estatus de una
// orden (R17, design D5). Las claves se anclan a `ORDER_STATUS_SEED` mediante un
// `Record` tipado: añadir/quitar un status rompe el build (no silencioso).
import type { GestionResultado } from "@prisma/client";

import { textoPendienteConfirmacion } from "@/components/shared/nota-pendiente-confirmacion";
import { ESTATUS_POR_RESULTADO } from "@/lib/types/gestion-destino";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDER_STATUS_LABELS, ORDER_STATUS_LABELS_RETIRADOS } from "./EstatusBadge";

const ESTATUS_LABELS: Record<(typeof ORDER_STATUS_SEED)[number], string> = ORDER_STATUS_LABELS;

/**
 * Etiqueta legible en español para un `value` de estatus. Fallback (R17):
 * `value` desconocido → se muestra el `value` crudo; `null`/vacío → "—".
 *
 * FICHA 454 (R40): un `value` RETIRADO del catálogo (fila histórica) se lee con la etiqueta que
 * tenía (`ORDER_STATUS_LABELS_RETIRADOS`) antes de caer al crudo.
 */
export function estatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (
    (ESTATUS_LABELS as Record<string, string>)[value] ?? ORDER_STATUS_LABELS_RETIRADOS[value] ?? value
  );
}

/**
 * FICHA 454 (R29/R30) — nombre visible de un RESULTADO de gestión: el del estado al que la
 * aprobación lo aplica (`ESTATUS_POR_RESULTADO`), leído del MISMO mapa que el chip de estado. No se
 * escribe a mano: cuando la 455 renombre los estados, el resultado se renombra con ellos.
 */
export function resultadoLabel(resultado: GestionResultado): string {
  return estatusLabel(ESTATUS_POR_RESULTADO[resultado]);
}

/** FICHA 454 (R29) — «<Resultado> · pendiente de confirmación», con el nombre canónico. */
export function notaGestionPendiente(resultado: GestionResultado): string {
  return textoPendienteConfirmacion(resultadoLabel(resultado));
}
