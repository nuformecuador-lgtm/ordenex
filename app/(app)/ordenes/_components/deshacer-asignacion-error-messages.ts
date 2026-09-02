// Feature 149 (T6.1, R37/R39/R40) — traduce el resultado no-"ok" de la Server Action
// `deshacerAsignacion` (lib/actions/deshacer-asignacion.ts) a un mensaje de usuario ACCIONABLE
// y DISTINTO por causa. Patrón `recuperar-bodega-error-messages.ts` (feature 100).
//
// Los motivos por-orden del `conflict` NO se re-escriben aquí como literales: se comparan contra
// las constantes tipadas de `lib/services/mensajes-deshacer-asignacion.ts` (T2.3: ningún literal
// de motivo duplicado entre service, tests y UI). Ese módulo son constantes puras (sin Prisma ni
// `next/`), así que es seguro importarlo desde un componente cliente.
//
// R40: ningún mensaje de esta capa expone UUIDs de orden/estado/usuario ni datos del
// destinatario. El `ordenId` del `detalle` se usa para señalar la fila, nunca para renderizar.

import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ESTADO_NO_REVERSIBLE,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_HISTORIAL,
  MSG_ZONA_CENTRAL_NO_CONFIGURADA,
  MSG_DESTINO_NO_DECLARADO,
} from "@/lib/services/mensajes-deshacer-asignacion";

import { estatusLabel } from "./estatus-label";

/**
 * Cotas del motivo (D4/R22). Espejo EXACTO del zod del borde
 * (`lib/actions/deshacer-asignacion.ts`): la UI valida ANTES de llamar para no ofrecer una
 * acción que el servidor va a rechazar (R37); el servidor sigue siendo la guardia real.
 */
export const MOTIVO_MIN_LEN = 10;
export const MOTIVO_MAX_LEN = 300;

/** Textos del campo de motivo (separados del JSX: listos para i18n). */
export const MOTIVO_LABEL = "Motivo";
export const MOTIVO_PLACEHOLDER =
  "Ej.: el mensajero se reportó enfermo y no pasará por la bodega hoy";
export const MOTIVO_AYUDA = `Obligatorio, entre ${MOTIVO_MIN_LEN} y ${MOTIVO_MAX_LEN} caracteres. Queda en la línea de tiempo de cada orden.`;
export const MOTIVO_INVALIDO = `Escribe un motivo de al menos ${MOTIVO_MIN_LEN} caracteres (máximo ${MOTIVO_MAX_LEN}).`;

/** R22/R37: ¿el motivo, ya recortado, cae dentro de las cotas? */
export function motivoValido(motivo: string): boolean {
  const limpio = motivo.trim();
  return limpio.length >= MOTIVO_MIN_LEN && limpio.length <= MOTIVO_MAX_LEN;
}

type DeshacerErrorStatus =
  | "forbidden"
  | "sin_zona"
  | "conflict"
  | "validation_error"
  | "unauthenticated";

/**
 * Mensaje por `status`. `forbidden` cubre las TRES causas de autorización del service (rol no
 * autorizado, orden de zona ajena y caso (b) pedido por un adminSatelite): el servidor no las
 * distingue en la respuesta —a propósito, para no filtrar qué órdenes existen fuera de tu
 * zona—, así que el texto nombra las dos salidas que el operador puede comprobar.
 */
const DESHACER_ERROR_MESSAGES: Record<DeshacerErrorStatus, string> = {
  forbidden:
    "No tienes permiso para deshacer esta asignación. Revisa que todas las órdenes sean de tu zona y que estén asignadas desde tu bodega.",
  sin_zona:
    "No tienes una zona asignada. Pide a un administrador que te asigne una zona.",
  conflict:
    "Algunas órdenes ya no se pueden devolver a bodega. Actualiza la lista e inténtalo de nuevo.",
  validation_error: MOTIVO_INVALIDO,
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
};

function isDeshacerErrorStatus(value: unknown): value is DeshacerErrorStatus {
  return typeof value === "string" && value in DESHACER_ERROR_MESSAGES;
}

/**
 * R39: mensaje accionable para UN motivo tipado del `conflict` (uno por orden). Cada causa
 * tiene su propio texto y su propia salida; el fallback nunca revela el motivo crudo.
 */
export function deshacerAsignacionConflictoMensaje(motivo: string): string {
  if (motivo === MSG_ORDEN_NO_EXISTE) {
    return "Alguna orden ya no existe. Actualiza la lista y vuelve a seleccionar.";
  }
  if (motivo === MSG_ORDEN_BORRADA) {
    return "Alguna orden fue eliminada. Actualiza la lista y quítala de la selección.";
  }
  if (motivo === MSG_SIN_HISTORIAL) {
    return "No se pudo determinar a qué bodega vuelve alguna orden: su historial no registra desde dónde se asignó. Contacta a un administrador.";
  }
  if (motivo === MSG_DESTINO_NO_DECLARADO) {
    return "No se puede devolver alguna orden a su bodega: el sistema no reconoce ese paso hacia atras. No es algo que puedas corregir desde aqui; contacta a un administrador.";
  }
  if (motivo === MSG_CARRERA) {
    return "Alguna orden cambió de estado mientras confirmabas. Actualiza la lista e inténtalo de nuevo.";
  }
  if (motivo.startsWith(`${MSG_ESTADO_NO_REVERSIBLE}:`)) {
    // El motivo trae el `value` del catálogo (público, no PII): se muestra su etiqueta legible.
    const value = motivo.slice(MSG_ESTADO_NO_REVERSIBLE.length + 1).trim();
    return `Alguna orden ya salió de la bodega (${estatusLabel(value)}): solo se puede deshacer antes de la recogida o de la recepción. Actualiza la lista.`;
  }
  if (motivo === MSG_ZONA_CENTRAL_NO_CONFIGURADA) {
    return "Falta configurar la zona de la bodega central. Contacta a un administrador.";
  }
  if (motivo === MSG_CATALOGO_INCOMPLETO) {
    return "Falta configuración del catálogo de estados. Contacta a un administrador.";
  }
  return DESHACER_ERROR_MESSAGES.conflict;
}

/**
 * R39: mensaje de usuario para un fallo de "Deshacer asignación". Acepta el resultado completo
 * de la acción (lanzado al canal de error del `Modal`) o el `status` crudo.
 *
 * - `conflict`: se traduce el PRIMER motivo del detalle (todo-o-nada: el lote entero se rechazó,
 *   y mostrar N mensajes en un toast no ayuda a decidir).
 * - `validation_error`: los `fieldErrors` de configuración (`zona`/`estatus`) tienen su propio
 *   texto; el resto cae en "motivo inválido", que es la única validación de campo del borde.
 */
export function deshacerAsignacionErrorMessage(error: unknown): string {
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
      ? deshacerAsignacionConflictoMensaje(motivo)
      : DESHACER_ERROR_MESSAGES.conflict;
  }

  if (status === "validation_error") {
    const fieldErrors = objeto?.fieldErrors;
    const primero =
      fieldErrors && typeof fieldErrors === "object"
        ? Object.values(fieldErrors as Record<string, unknown>).flat()[0]
        : undefined;
    // Las guardas de CONFIGURACIÓN del service (`zona`/`estatus`) viajan como fieldErrors con
    // su constante tipada; el resto de `validation_error` viene del zod del borde y siempre es
    // el motivo (el único campo de texto del formulario).
    if (
      primero === MSG_ZONA_CENTRAL_NO_CONFIGURADA ||
      primero === MSG_CATALOGO_INCOMPLETO
    ) {
      return deshacerAsignacionConflictoMensaje(primero);
    }
    return DESHACER_ERROR_MESSAGES.validation_error;
  }

  return isDeshacerErrorStatus(status)
    ? DESHACER_ERROR_MESSAGES[status]
    : "No se pudo deshacer la asignación.";
}
