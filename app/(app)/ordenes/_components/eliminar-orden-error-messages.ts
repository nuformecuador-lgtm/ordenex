// Feature «eliminar orden» — traduce el resultado no-"ok" de la Server Action `eliminarOrdenes`
// (lib/actions/eliminar-orden.ts) a un mensaje de usuario ACCIONABLE y DISTINTO por causa.
// Patrón `deshacer-asignacion-error-messages.ts`.
//
// Los motivos por-orden del `conflict` NO se re-escriben aquí como literales: se comparan contra
// las constantes tipadas de `lib/services/mensajes-eliminar-orden.ts`. Ese módulo son constantes
// puras (sin Prisma ni `next/`), así que es seguro importarlo desde un componente cliente.
//
// Ningún mensaje de esta capa expone UUIDs ni datos del destinatario.

import {
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

type EliminarErrorStatus =
  | "forbidden"
  | "conflict"
  | "validation_error"
  | "unauthenticated";

const ELIMINAR_ERROR_MESSAGES: Record<EliminarErrorStatus, string> = {
  forbidden: "No tienes permiso para eliminar órdenes.",
  conflict:
    "Algunas órdenes ya no se pueden eliminar. Actualiza la lista e inténtalo de nuevo.",
  validation_error:
    "La selección no es válida. Actualiza la lista y vuelve a marcar las órdenes.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
};

/** Mensaje accionable para UN motivo tipado del `conflict` (uno por orden). */
export function eliminarOrdenConflictoMensaje(motivo: string): string {
  if (motivo === MSG_ORDEN_NO_EXISTE) {
    return "Alguna orden ya no existe. Actualiza la lista y vuelve a seleccionar.";
  }
  if (motivo === MSG_ORDEN_YA_BORRADA) {
    return "Alguna orden ya había sido eliminada. Actualiza la lista y quítala de la selección.";
  }
  return ELIMINAR_ERROR_MESSAGES.conflict;
}

/**
 * Mensaje de usuario para un fallo de "Eliminar". Acepta el resultado completo de la acción
 * (lanzado al canal de error del `Modal`) o el `status` crudo. En `conflict` se traduce el
 * PRIMER motivo del detalle: el lote es todo-o-nada, así que el resto no añade decisión.
 */
export function eliminarOrdenErrorMessage(error: unknown): string {
  const objeto = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = objeto && "status" in objeto ? objeto.status : error;

  if (status === "conflict") {
    const detalle = objeto?.detalle;
    const primero = Array.isArray(detalle) ? detalle[0] : undefined;
    const motivo =
      primero && typeof primero === "object" && "motivo" in primero
        ? (primero as { motivo: unknown }).motivo
        : undefined;
    return typeof motivo === "string"
      ? eliminarOrdenConflictoMensaje(motivo)
      : ELIMINAR_ERROR_MESSAGES.conflict;
  }

  if (typeof status === "string" && status in ELIMINAR_ERROR_MESSAGES) {
    return ELIMINAR_ERROR_MESSAGES[status as EliminarErrorStatus];
  }
  return "No se pudieron eliminar las órdenes. Inténtalo de nuevo.";
}
