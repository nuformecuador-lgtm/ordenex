// Feature 100 (T3.2) — traduce el `status` no-"ok" de la Server Action
// `reprogramarNovedad` (lib/actions/resolver-novedad.ts) a un mensaje de usuario
// claro POR ESTADO, sin filtrar internals ni PII. Patrón
// `devolucion-origen-error-messages.ts` (feature 48). Acepta tanto el resultado
// lanzado (objeto con `.status`, canal de error del `Modal`) como el `status` crudo
// (string). Voseo, consistente con el resto de /novedades.

type ReprogramarNovedadErrorStatus =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "config_error"
  | "unauthenticated"
  | "validation_error";

const REPROGRAMAR_NOVEDAD_ERROR_MESSAGES: Record<
  ReprogramarNovedadErrorStatus,
  string
> = {
  forbidden: "No tenés permiso para reprogramar esta orden.",
  not_found: "No se encontró la orden.",
  conflict: "La orden ya salió de devolución. Actualizá la lista.",
  config_error:
    "Falta configuración del catálogo de estados. Contactá a un administrador.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  validation_error: "La fecha debe ser mañana o posterior.",
};

function isReprogramarNovedadErrorStatus(
  value: unknown,
): value is ReprogramarNovedadErrorStatus {
  return (
    typeof value === "string" && value in REPROGRAMAR_NOVEDAD_ERROR_MESSAGES
  );
}

/**
 * Mensaje de usuario para un fallo de la reprogramación; fallback genérico
 * defensivo. `error` puede ser el resultado lanzado (`{ status }`) o el `status`
 * crudo (string).
 */
export function reprogramarNovedadErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : error;
  return isReprogramarNovedadErrorStatus(status)
    ? REPROGRAMAR_NOVEDAD_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
