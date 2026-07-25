// Feature 48 (T8/T9) / Feature 139 (T3.2, R15) — traduce el `status` no-"ok" de la
// Server Action `devolverATienda` (lib/actions/devolucion-origen.ts) a un mensaje de
// usuario, sin filtrar internals ni PII. Patrón `guia-decision-error-messages.ts`
// (feature 17). Acepta tanto el resultado lanzado (objeto con `.status`, patrón del
// canal de error del `Modal`) como el `status` crudo (string). Con la 139 el ORIGEN de
// la transición pasó de `rechazada` a `por_devolver_a_tienda` (la salida de `rechazada`
// es ahora la aprobación del cierre), así que los mensajes hablan de "enviar a la tienda".

type DevolucionOrigenErrorStatus =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "config_error"
  | "unauthenticated"
  | "validation_error";

const DEVOLUCION_ORIGEN_ERROR_MESSAGES: Record<
  DevolucionOrigenErrorStatus,
  string
> = {
  forbidden: "No tienes permiso para enviar esta orden a la tienda.",
  not_found: "No se encontró la orden.",
  conflict: "Alguna orden ya no está en estado “Por devolver a tienda”.",
  config_error:
    "Falta configuración del catálogo de estados. Contacta a un administrador.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  validation_error: "Datos inválidos.",
};

function isDevolucionOrigenErrorStatus(
  value: unknown,
): value is DevolucionOrigenErrorStatus {
  return (
    typeof value === "string" && value in DEVOLUCION_ORIGEN_ERROR_MESSAGES
  );
}

/**
 * Mensaje de usuario para un fallo del retorno a la tienda; fallback genérico
 * defensivo. `error` puede ser el resultado lanzado (`{ status }`) o el `status`
 * crudo (string).
 */
export function devolucionOrigenErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : error;
  return isDevolucionOrigenErrorStatus(status)
    ? DEVOLUCION_ORIGEN_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
