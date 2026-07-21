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
// satélite bloqueada. La regla real (decisión del humano 2026-07-16) es AL MENOS 1
// mensajero con cierre abierto (`solicitado`/`vencido`), no "todos". Coincide con el
// `motivo` que emite `GuiaAsignacionService` (substring estable, tolerante a
// acentos/variantes).
const MOTIVO_BODEGA_SATELITE_BLOQUEADA = "bodega satelite bloqueada";
const MSG_BODEGA_SATELITE_BLOQUEADA =
  "No se puede enviar a una bodega satélite que tiene al menos un mensajero con un cierre abierto. Espera a que se resuelva el cierre.";

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

// Feature 97/R9 — gate de asignabilidad por coordenadas (#98). El `conflict` trae, por orden,
// un `motivo` que es LITERALMENTE el `EstadoAsignabilidad` (verificado: `motivoAsignabilidad`
// devuelve el estado tal cual y `GuiaAsignacionService` lo copia al `DetalleConflicto`). Se
// distinguen dos clases:
//   - TERMINAL: la geocodificación ya concluyó que la dirección no existe / agotó intentos.
//   - EN PROGRESO: la dirección aún se está validando (job en curso o recién encolado).
const MOTIVOS_DIRECCION_NO_ENCONTRADA = [
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
];
const MOTIVOS_DIRECCION_VALIDANDO = [
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
];
const MSG_DIRECCION_NO_ENCONTRADA = "Dirección no encontrada";
const MSG_DIRECCION_VALIDANDO =
  "La dirección aún se está validando. Intenta de nuevo en unos minutos.";

/** Devuelve los `motivo` del `detalle` del conflicto (vacío si no aplica). */
function motivosDelConflicto(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const detalle = (error as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return [];
  return detalle
    .map((d) =>
      d &&
      typeof d === "object" &&
      typeof (d as { motivo?: unknown }).motivo === "string"
        ? (d as { motivo: string }).motivo
        : null,
    )
    .filter((m): m is string => m !== null);
}

/**
 * R9: mensaje del conflicto de asignabilidad por coordenadas. `null` si el conflicto no es de
 * geocodificación (deja pasar al mensaje genérico). El caso TERMINAL ("no encontrada") tiene
 * prioridad sobre el EN PROGRESO: es más accionable y no se resuelve solo esperando.
 */
function mensajeGeocodificacion(error: unknown): string | null {
  const motivos = motivosDelConflicto(error);
  if (motivos.some((m) => MOTIVOS_DIRECCION_NO_ENCONTRADA.includes(m))) {
    return MSG_DIRECCION_NO_ENCONTRADA;
  }
  if (motivos.some((m) => MOTIVOS_DIRECCION_VALIDANDO.includes(m))) {
    return MSG_DIRECCION_VALIDANDO;
  }
  return null;
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function guiaDecisionErrorMessage(error: unknown): string {
  if (tieneBodegaSateliteBloqueada(error)) return MSG_BODEGA_SATELITE_BLOQUEADA;
  const geocodificacion = mensajeGeocodificacion(error);
  if (geocodificacion !== null) return geocodificacion;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isGuiaErrorStatus(status)
    ? GUIA_ERROR_MESSAGES[status]
    : "No se pudo completar la operación.";
}
