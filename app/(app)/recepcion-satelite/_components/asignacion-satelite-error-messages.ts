// Feature 34 (T9) — traduce el `status` de un resultado no-"ok" de
// `asignarDesdeSatelite` (lib/types/recepcion-satelite.ts) a un mensaje de usuario,
// sin filtrar `fieldErrors`/`detalle` internos ni PII. Patrón
// `guia-decision-error-messages.ts` (feature 17).

type AsignacionSateliteErrorStatus =
  | "unauthenticated"
  | "forbidden"
  | "sin_zona"
  | "validation_error"
  | "conflict";

const ASIGNACION_SATELITE_ERROR_MESSAGES: Record<
  AsignacionSateliteErrorStatus,
  string
> = {
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para esta acción.",
  sin_zona: "No tienes una zona asignada. Pide a un administrador que te asigne una.",
  validation_error: "Datos inválidos: revisa la selección de mensajero.",
  conflict: "Alguna orden ya no está en un estado válido para asignarse.",
};

function isAsignacionSateliteErrorStatus(
  value: unknown,
): value is AsignacionSateliteErrorStatus {
  return (
    typeof value === "string" && value in ASIGNACION_SATELITE_ERROR_MESSAGES
  );
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function asignacionSateliteErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isAsignacionSateliteErrorStatus(status)
    ? ASIGNACION_SATELITE_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
