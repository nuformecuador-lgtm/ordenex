// Feature 29 — Mapa de presentación (frontend) value → label del estatus de una
// orden (R17, design D5). Las claves se anclan a `ORDER_STATUS_SEED` mediante un
// `Record` tipado: añadir/quitar un status rompe el build (no silencioso).
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDER_STATUS_LABELS } from "./EstatusBadge";

const ESTATUS_LABELS: Record<(typeof ORDER_STATUS_SEED)[number], string> = ORDER_STATUS_LABELS;

/**
 * Etiqueta legible en español para un `value` de estatus. Fallback (R17):
 * `value` desconocido → se muestra el `value` crudo; `null`/vacío → "—".
 */
export function estatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (ESTATUS_LABELS as Record<string, string>)[value] ?? value;
}
