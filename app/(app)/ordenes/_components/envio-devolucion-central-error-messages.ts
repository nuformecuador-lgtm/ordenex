// Feature 139 (T3.3) — traduce el `status` no-"ok" de la Server Action `enviarACentral`
// (lib/actions/envio-devolucion-central.ts) a un mensaje de usuario claro POR ESTADO, sin
// filtrar internals ni PII. Patrón `devolucion-origen-error-messages.ts` (feature 48). El
// adminSatelite lo consume en /recepcion-satelite (envío por lote de `por_devolver`);
// acepta tanto el `status` crudo (string) como el resultado (`{ status }`).

type EnvioDevolucionCentralErrorStatus =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "config_error"
  | "unauthenticated"
  | "validation_error";

const ENVIO_DEVOLUCION_CENTRAL_ERROR_MESSAGES: Record<
  EnvioDevolucionCentralErrorStatus,
  string
> = {
  forbidden: "No tienes permiso para enviar esta orden a la bodega central.",
  not_found: "No se encontró la orden.",
  conflict: "Alguna orden ya no está en estado “Por devolver”.",
  config_error:
    "Falta configuración del catálogo de estados. Contacta a un administrador.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  validation_error: "Datos inválidos.",
};

function isEnvioDevolucionCentralErrorStatus(
  value: unknown,
): value is EnvioDevolucionCentralErrorStatus {
  return (
    typeof value === "string" &&
    value in ENVIO_DEVOLUCION_CENTRAL_ERROR_MESSAGES
  );
}

/**
 * Mensaje de usuario para un fallo del envío a bodega central; fallback genérico
 * defensivo. `error` puede ser el resultado (`{ status }`) o el `status` crudo (string).
 */
export function envioDevolucionCentralErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : error;
  return isEnvioDevolucionCentralErrorStatus(status)
    ? ENVIO_DEVOLUCION_CENTRAL_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
