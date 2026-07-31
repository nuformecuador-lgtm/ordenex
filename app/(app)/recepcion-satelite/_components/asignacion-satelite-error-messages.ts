// Feature 34 (T9) — traduce el `status` de un resultado no-"ok" de
// `asignarDesdeSatelite` (lib/types/recepcion-satelite.ts) a un mensaje de usuario,
// sin filtrar `fieldErrors`/`detalle` internos ni PII. Patrón
// `guia-decision-error-messages.ts` (feature 17).
// Feature 41 (R22): añade el caso `bodega_bloqueada`, cuyo mensaje DIFERENCIA la causa
// (porMensajeros / porCierreBodega) reutilizando `bodegaBloqueadaMensaje`.

import { geocodificacionMotivoMessage } from "@/app/(app)/_components/geocodificacion-motivo-messages";

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
  conflict:
    "Alguna orden de la selección ya no se puede asignar. Actualiza la lista y vuelve a intentarlo.",
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

// Motivos del `detalle` de un `conflict` que tienen CAUSA PROPIA. Sin ellos todos caen en el
// genérico, que habla de "estado" y miente cuando el estado era correcto y lo que fallaba era
// otra cosa. Se reconocen por substring del `motivo` que emite `AsignacionSateliteService`
// (allí los literales van en snake_case); el ORDEN define la precedencia.
const MOTIVOS_CON_CAUSA_PROPIA: readonly { fragmento: string; mensaje: string }[] = [
  {
    fragmento: "mensajero_bloqueado_por_cierre",
    mensaje:
      "El mensajero que elegiste tiene un cierre sin resolver, así que no puede recibir órdenes nuevas. Resuelve el cierre o elige otro mensajero.",
  },
  {
    fragmento: "zona_ajena",
    mensaje:
      "Alguna orden no es de tu zona, así que no puedes asignarla. Quítala de la selección.",
  },
  {
    fragmento: "estado_invalido",
    mensaje:
      "Alguna orden ya cambió de estado y esta acción no le aplica. Actualiza la lista y vuelve a intentarlo.",
  },
  {
    fragmento: "no_encontrada",
    mensaje:
      "Alguna orden de la selección ya no está disponible. Actualiza la lista y vuelve a intentarlo.",
  },
];

/** Mensaje propio del primer motivo reconocido en el `detalle`, o `null` si no hay ninguno. */
function mensajePorMotivo(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const detalle = (error as { detalle?: unknown }).detalle;
  if (!Array.isArray(detalle)) return null;
  const motivos = detalle
    .map((d) =>
      d && typeof d === "object" ? (d as { motivo?: unknown }).motivo : undefined,
    )
    .filter((m): m is string => typeof m === "string");
  return (
    MOTIVOS_CON_CAUSA_PROPIA.find(({ fragmento }) =>
      motivos.some((m) => m.includes(fragmento)),
    )?.mensaje ?? null
  );
}

/** Mensaje de usuario para el error lanzado por `Modal.onConfirm`; fallback genérico defensivo. */
export function asignacionSateliteErrorMessage(error: unknown): string {
  // Feature 41/R22: bodega bloqueada -> mensaje que diferencia la causa (i)/(ii).
  if (isBodegaBloqueada(error)) {
    return bodegaBloqueadaMensaje(error.causa);
  }
  // Feature 93 (R9): mismo mapeo compartido que `guiaDecisionErrorMessage`, para
  // que `AsignarSateliteModal` no quede con el mensaje genérico de `conflict`.
  const porGeocodificacion = geocodificacionMotivoMessage(error);
  if (porGeocodificacion !== null) return porGeocodificacion;
  // Igual que el mapper del maestro: el motivo por orden se lee ANTES del switch por status,
  // para no caer en el generico de `conflict` teniendo una causa concreta que contar.
  const porMotivo = mensajePorMotivo(error);
  if (porMotivo !== null) return porMotivo;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isAsignacionSateliteErrorStatus(status)
    ? ASIGNACION_SATELITE_ERROR_MESSAGES[status]
    : "No se pudo completar la operación. Actualiza la página y vuelve a intentarlo.";
}
