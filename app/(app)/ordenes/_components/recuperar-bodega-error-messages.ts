// Feature 100 (T4.1/T4.2) — traduce el `status` no-"ok" de la Server Action
// `recuperarABodega` (lib/actions/resolver-novedad.ts) a un mensaje de usuario claro
// POR ESTADO, sin filtrar internals ni PII. Patrón `devolucion-origen-error-messages.ts`
// (feature 48). Se reutiliza en DOS superficies: /recepcion-satelite (adminSatelite,
// error por-fila con el `status` crudo) y /ordenes (maestro/admin, canal de error del
// `Modal` con el resultado lanzado `{ status }`). Acepta ambas formas. Tuteo, como
// `devolucion-origen`.

type RecuperarBodegaErrorStatus =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "config_error"
  | "unauthenticated"
  | "validation_error";

const RECUPERAR_BODEGA_ERROR_MESSAGES: Record<
  RecuperarBodegaErrorStatus,
  string
> = {
  forbidden: "No tienes permiso para recuperar esta orden a bodega.",
  not_found: "No se encontró la orden.",
  conflict: "La orden ya salió de devolución. Actualiza la lista.",
  config_error:
    "Falta configuración del catálogo de estados. Contacta a un administrador.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  validation_error: "Datos inválidos: revisa la selección y vuelve a intentarlo.",
};

function isRecuperarBodegaErrorStatus(
  value: unknown,
): value is RecuperarBodegaErrorStatus {
  return typeof value === "string" && value in RECUPERAR_BODEGA_ERROR_MESSAGES;
}

/**
 * Mensaje de usuario para un fallo de la recuperación a bodega; fallback genérico
 * defensivo. `error` puede ser el resultado lanzado (`{ status }`) o el `status`
 * crudo (string).
 */
export function recuperarBodegaErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : error;
  return isRecuperarBodegaErrorStatus(status)
    ? RECUPERAR_BODEGA_ERROR_MESSAGES[status]
    : "No se pudo completar la operación. Actualiza la página y vuelve a intentarlo.";
}
