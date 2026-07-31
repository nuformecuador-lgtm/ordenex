// Feature 17 (T18/T19) — traduce el `status` de un resultado no-"ok" de
// `generarGuia`/`asignarDesdeBodega` (lib/types/orden-guia.ts) a un mensaje de
// usuario, sin filtrar `fieldErrors`/`detalle` internos ni PII. Patrón
// `app/(app)/_components/decision-error-messages.ts` (feature 23).

import { geocodificacionMotivoMessage } from "@/app/(app)/_components/geocodificacion-motivo-messages";

type GuiaErrorStatus =
  | "unauthenticated"
  | "forbidden"
  | "validation_error"
  | "conflict";

const GUIA_ERROR_MESSAGES: Record<GuiaErrorStatus, string> = {
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para esta acción.",
  // Feature 156: este mapper lo comparten "Generar guía" (que YA NO elige mensajero) y
  // "Asignar desde bodega" (que sí), así que la copia no puede nombrar un control que
  // solo existe en una de las dos. Mismo literal que los mappers vecinos de esta carpeta
  // (`recuperar-bodega`, `envio-devolucion-central`, `devolucion-origen`).
  validation_error: "Datos inválidos: revisa la selección y vuelve a intentarlo.",
  conflict:
    "Alguna orden de la selección ya no admite esta acción. Actualiza la lista y vuelve a intentarlo.",
};

function isGuiaErrorStatus(value: unknown): value is GuiaErrorStatus {
  return typeof value === "string" && value in GUIA_ERROR_MESSAGES;
}

// Motivos del `detalle` de un `conflict` que tienen CAUSA PROPIA, y por tanto mensaje
// propio: sin ellos todos caen en el genérico de `conflict`, que habla de "estado" y
// miente cuando la orden estaba en un estado perfectamente válido. Se reconocen por
// substring estable del `motivo` que emite `GuiaAsignacionService` (tolerante a
// acentos/variantes); el ORDEN define la precedencia cuando el lote acumula varios.
const MOTIVOS_CON_CAUSA_PROPIA: readonly { fragmento: string; mensaje: string }[] = [
  {
    // Ruteo a satélite. La regla real (decisión del humano 2026-07-16) es AL MENOS 1
    // mensajero con cierre abierto (`solicitado`/`vencido`), no "todos".
    fragmento: "bodega satelite bloqueada",
    mensaje:
      "No se puede enviar a una bodega satélite que tiene al menos un mensajero con un cierre abierto. Espera a que se resuelva el cierre.",
  },
  {
    // Asignación desde bodega: el mensajero ELEGIDO arrastra un cierre sin resolver
    // (`solicitado`/`vencido`/`rechazado`), así que no recibe órdenes nuevas.
    fragmento: "mensajero bloqueado por cierre pendiente",
    mensaje:
      "El mensajero que elegiste tiene un cierre sin resolver, así que no puede recibir órdenes nuevas. Resuelve el cierre o elige otro mensajero.",
  },
  {
    // Feature 157 (regla de dedicación): recolectar y repartir son viajes incompatibles.
    fragmento: "recoleccion en tienda pendiente",
    mensaje:
      "El mensajero que elegiste tiene una recolección en tienda sin confirmar, así que no puede recibir reparto todavía. Espera a que la recolecte, quítale esa recolección, o elige otro mensajero.",
  },
  {
    // La cara opuesta de la misma regla.
    fragmento: "ordenes de reparto pendientes",
    mensaje:
      "El mensajero que elegiste tiene órdenes de reparto pendientes, y una recolección en tienda se hace sin carga. Elige un mensajero libre.",
  },
  {
    // Feature 46/R2: la orden está congelada hasta su fecha de reprogramación.
    fragmento: "orden reprogramada",
    mensaje:
      "Alguna orden está reprogramada y queda bloqueada hasta su fecha. Quítala de la selección para continuar.",
  },
  {
    // La orden cambió de estado entre que se pintó la tabla y se confirmó la acción: otra
    // persona la movió, o la propia pestaña quedó vieja.
    fragmento: "estado de origen no permitido",
    mensaje:
      "Alguna orden ya cambió de estado y esta acción no le aplica. Actualiza la lista y vuelve a intentarlo.",
  },
  {
    fragmento: "orden no existe",
    mensaje:
      "Alguna orden de la selección ya no existe. Actualiza la lista y vuelve a intentarlo.",
  },
  {
    fragmento: "orden borrada",
    mensaje:
      "Alguna orden de la selección fue eliminada. Actualiza la lista y vuelve a intentarlo.",
  },
  {
    // Feature 30: rutear a satélite es solo para órdenes cuya zona NO es la central.
    fragmento: "orden GAM no se rutea a satelite",
    mensaje:
      "Alguna orden es de la zona central, y a una bodega satélite solo se rutean las de otras zonas. Quítala de la selección.",
  },
  {
    // Su espejo: asignar desde la bodega central es solo para órdenes de esa zona.
    fragmento: "zona no-GAM",
    mensaje:
      "Alguna orden no es de la zona central, así que no se asigna desde esa bodega. La asigna el admin de la bodega satélite de su zona.",
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
export function guiaDecisionErrorMessage(error: unknown): string {
  const porMotivo = mensajePorMotivo(error);
  if (porMotivo !== null) return porMotivo;
  // Feature 93 (R9): el mapeo de los `motivo` del gate de coordenadas (feature 92) vive en UN
  // solo sitio (`geocodificacion-motivo-messages`) y lo consultan LOS DOS mappers de asignación
  // (este y `asignacionSateliteErrorMessage`). Se lee ANTES del switch por `status` para no caer
  // en el mensaje genérico de `conflict`; el caso TERMINAL gana sobre el EN PROGRESO ahí dentro.
  const geocodificacion = geocodificacionMotivoMessage(error);
  if (geocodificacion !== null) return geocodificacion;
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  return isGuiaErrorStatus(status)
    ? GUIA_ERROR_MESSAGES[status]
    : "No se pudo completar la operación. Actualiza la página y vuelve a intentarlo.";
}
