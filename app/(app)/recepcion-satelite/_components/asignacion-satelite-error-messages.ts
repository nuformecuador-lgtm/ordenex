// Feature 34 (T9) — traduce el `status` de un resultado no-"ok" de
// `asignarDesdeSatelite` (lib/types/recepcion-satelite.ts) a un mensaje de usuario,
// sin filtrar `fieldErrors`/`detalle` internos ni PII. Patrón
// `guia-decision-error-messages.ts` (feature 17).
// Feature 41 (R22): añade el caso `bodega_bloqueada`, cuyo mensaje DIFERENCIA la causa
// (porMensajeros / porCierreBodega) reutilizando `bodegaBloqueadaMensaje`.

import {
  bodegaBloqueadaMensaje,
  type BodegaBloqueoCausa,
} from "./asignacion-satelite-bloqueo";

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

/** Type guard del resultado `bodega_bloqueada` (feature 41/R22) con su causa. */
function isBodegaBloqueada(
  error: unknown,
): error is { status: "bodega_bloqueada"; causa: BodegaBloqueoCausa } {
  if (!error || typeof error !== "object") return false;
  if ((error as { status?: unknown }).status !== "bodega_bloqueada") return false;
  const causa = (error as { causa?: unknown }).causa;
  return (
    typeof causa === "object" &&
    causa !== null &&
    "porMensajeros" in causa &&
    "porCierreBodega" in causa
  );
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function asignacionSateliteErrorMessage(error: unknown): string {
  // Feature 41/R22: bodega bloqueada -> mensaje que diferencia la causa (i)/(ii).
  if (isBodegaBloqueada(error)) {
    return bodegaBloqueadaMensaje(error.causa);
  }
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isAsignacionSateliteErrorStatus(status)
    ? ASIGNACION_SATELITE_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
