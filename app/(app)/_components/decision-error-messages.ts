import type { ActionError } from "@/lib/types/orden";

// Feature 23 (R18) — traduce el `status` de un ActionError de las Server Actions
// de la feature 22 a un mensaje de usuario, sin filtrar detalles internos ni PII.

const DECISION_ERROR_MESSAGES: Record<ActionError["status"], string> = {
  validation_error: "No se pudo procesar la solicitud.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para esta acción.",
  not_found: "La postulación ya no existe.",
  conflict: "La postulación ya fue procesada.",
};

/** Mensaje de usuario para un status de ActionError; fallback genérico defensivo. */
export function decisionErrorMessage(status: ActionError["status"]): string {
  return (
    DECISION_ERROR_MESSAGES[status] ?? "No se pudo procesar la solicitud."
  );
}
