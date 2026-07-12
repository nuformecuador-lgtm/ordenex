// Feature 17 (T18/T19) — traduce el `status` de un resultado no-"ok" de
// `generarGuia`/`asignarDesdeBodega` (lib/types/orden-guia.ts) a un mensaje de
// usuario, sin filtrar `fieldErrors`/`detalle` internos ni PII. Patrón
// `app/(app)/_components/decision-error-messages.ts` (feature 23).

type GuiaErrorStatus =
  | "unauthenticated"
  | "forbidden"
  | "validation_error"
  | "conflict";

const GUIA_ERROR_MESSAGES: Record<GuiaErrorStatus, string> = {
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para esta acción.",
  validation_error: "Datos inválidos: revisa la selección de mensajero.",
  conflict: "Alguna orden ya no está en un estado válido para esta acción.",
};

function isGuiaErrorStatus(value: unknown): value is GuiaErrorStatus {
  return typeof value === "string" && value in GUIA_ERROR_MESSAGES;
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function guiaDecisionErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isGuiaErrorStatus(status)
    ? GUIA_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
