import type { ActionError } from "@/lib/types/orden";

// Feature 253 (T7.2, R34) — traduce el `status` de un `ActionError` de
// `lib/actions/atencion-postulaciones-recurso.ts` a un mensaje de usuario, sin filtrar detalles
// internos ni PII.
//
// ⚠️ VA APARTE DE `decision-error-messages.ts` (feature 23) A PROPOSITO, aunque las dos listas se
// parezcan: aquella habla de la postulacion de un MENSAJERO —una persona que espera acceso— y esta
// de un vehiculo o una bodega. Compartirlas ataria dos dominios que solo comparten la palabra
// "postulacion" (design §7), y el dia que uno de los dos textos cambie, cambiaria el del otro sin
// que nadie lo pidiera.
//
// El `Record<ActionError["status"], string>` es deliberado: si manana `ActionError` gana un
// desenlace, **el typecheck se rompe** hasta que alguien le escriba su texto. Un mensaje
// equivocado es peor que ninguno (leccion de la 248).

const MENSAJE_POR_STATUS: Record<ActionError["status"], string> = {
  validation_error: "No se pudo procesar la solicitud.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para marcar postulaciones como atendidas.",
  not_found: "Esa postulación ya no existe.",
  conflict: "Esa postulación ya la atendió alguien más.",
};

/**
 * Mensaje de usuario para un `status` de `ActionError`.
 *
 * El fallback NO es decorativo: la promesa de la Server Action puede romperse por red, y ahi no
 * llega ningun `status`. Que ese camino tenga texto es lo que impide que el panel se quede MUDO
 * (R34), que es el defecto que esta ficha viene a cerrar una capa mas abajo.
 */
export function postulacionRecursoErrorMessage(status: string): string {
  return (
    MENSAJE_POR_STATUS[status as ActionError["status"]] ??
    "No se pudo marcar la postulación como atendida. Volvé a intentarlo."
  );
}
