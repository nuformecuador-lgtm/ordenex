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

// Ajuste maestro: mensaje específico cuando el `conflict` viene por rutear a una bodega
// satélite cuyos mensajeros están TODOS en cierre. Coincide con el `motivo` que emite
// `GuiaAsignacionService` (substring estable, tolerante a acentos/variantes).
const MOTIVO_BODEGA_SATELITE_BLOQUEADA = "bodega satelite bloqueada";
const MSG_BODEGA_SATELITE_BLOQUEADA =
  "No se puede enviar a una bodega satélite cuyos mensajeros están todos con un cierre abierto. Espera a que alguno resuelva su cierre.";

/** ¿El `conflict` incluye el motivo de bodega satélite bloqueada? */
function tieneBodegaSateliteBloqueada(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detalle = (error as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return false;
  return detalle.some(
    (d) =>
      d &&
      typeof d === "object" &&
      typeof (d as { motivo?: unknown }).motivo === "string" &&
      (d as { motivo: string }).motivo.includes(MOTIVO_BODEGA_SATELITE_BLOQUEADA),
  );
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function guiaDecisionErrorMessage(error: unknown): string {
  if (tieneBodegaSateliteBloqueada(error)) return MSG_BODEGA_SATELITE_BLOQUEADA;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isGuiaErrorStatus(status)
    ? GUIA_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
