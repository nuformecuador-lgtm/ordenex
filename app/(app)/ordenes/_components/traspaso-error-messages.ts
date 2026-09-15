// FICHA 427 (T22, R37) — traduce el resultado no-"ok" de la Server Action `traspasarMensajero`
// (lib/actions/traspasar-mensajero.ts) a un mensaje de usuario ACCIONABLE y DISTINTO por causa.
// Patrón literal de `deshacer-asignacion-error-messages.ts` (149) y
// `corregir-dia-reparto-error-messages.ts` (262).
//
// Los motivos por-orden del `conflict` y los del `validation_error` NO se re-escriben aquí como
// literales: se comparan contra las constantes tipadas de `lib/services/mensajes-traspaso.ts`
// (T14: ningún literal de motivo duplicado entre service, tests y UI). Ese módulo son constantes
// puras —sin Prisma, sin `next/`—, así que es seguro importarlo desde un componente cliente.
//
// R37: ningún mensaje de esta capa expone UUIDs de orden, de estado ni de usuario, ni datos del
// destinatario de la orden (nombre, dirección, teléfono, monto). El único dato variable que se
// pinta es el `value` público del catálogo de estados, ya traducido a su etiqueta legible.

import {
  MSG_CARRERA_TRASPASO,
  MSG_DESTINO_IGUAL_A_ORIGEN,
  MSG_DESTINO_NO_VALIDO,
  MSG_ESTADO_NO_TRASPASABLE,
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_CON_RECOLECCION,
  MSG_MENSAJERO_NO_ASIGNABLE,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_DE_OTRO_MENSAJERO,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_SIN_MENSAJERO,
  MSG_ORIGEN_NO_UNICO,
} from "@/lib/services/mensajes-traspaso";

import { estatusLabel } from "./estatus-label";

/**
 * Cotas del motivo (R28). Espejo EXACTO del zod del borde
 * (`lib/actions/traspasar-mensajero.ts`): la UI valida ANTES de llamar para no ofrecer una acción
 * que el servidor va a rechazar; el servidor sigue siendo la guardia real.
 */
export const MOTIVO_MIN_LEN = 10;
export const MOTIVO_MAX_LEN = 300;

/** Textos del campo de motivo (separados del JSX: listos para i18n). */
export const MOTIVO_LABEL = "Motivo";
export const MOTIVO_PLACEHOLDER =
  "Ej.: el mensajero se reportó enfermo a media jornada y no puede seguir la ruta";
export const MOTIVO_AYUDA = `Obligatorio, entre ${MOTIVO_MIN_LEN} y ${MOTIVO_MAX_LEN} caracteres. Queda en la línea de tiempo de cada orden.`;
export const MOTIVO_INVALIDO = `Escribe un motivo de al menos ${MOTIVO_MIN_LEN} caracteres (máximo ${MOTIVO_MAX_LEN}).`;

/** R28: ¿el motivo, ya recortado, cae dentro de las cotas? */
export function motivoValido(motivo: string): boolean {
  const limpio = motivo.trim();
  return limpio.length >= MOTIVO_MIN_LEN && limpio.length <= MOTIVO_MAX_LEN;
}

type TraspasoErrorStatus =
  | "forbidden"
  | "conflict"
  | "validation_error"
  | "unauthenticated";

/**
 * Mensaje por `status`, para cuando el desenlace no trae un motivo tipado que traducir.
 *
 * `forbidden` cubre las dos causas de autorización del service (rol sin acceso total y, por D1, el
 * `adminSatelite`): el servidor no las distingue en la respuesta, así que el texto nombra la única
 * salida que quien lo lee puede comprobar.
 */
const TRASPASO_ERROR_MESSAGES: Record<TraspasoErrorStatus, string> = {
  forbidden:
    "No tienes permiso para traspasar órdenes entre mensajeros. Pídeselo a un administrador de la bodega central.",
  conflict:
    "Algunas órdenes ya no se pueden traspasar. Actualiza la lista e inténtalo de nuevo.",
  validation_error: MOTIVO_INVALIDO,
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
};

function esTraspasoErrorStatus(value: unknown): value is TraspasoErrorStatus {
  return typeof value === "string" && value in TRASPASO_ERROR_MESSAGES;
}

/**
 * R37: mensaje accionable para UN motivo tipado del servicio. Cada causa tiene su propio texto y
 * su propia salida; el fallback nunca revela el motivo crudo.
 *
 * Las SIETE causas que el servicio puede devolver, y qué se hace con cada una:
 *
 *   1. estado no traspasable  -> se nombra el estado (etiqueta legible) y a dónde ir con esa orden;
 *   2. lote con dos orígenes  -> filtrar por un solo mensajero;
 *   3. destino == origen      -> elegir otro (la UI ya lo excluye del selector; esto es la red);
 *   4. destino no válido      -> rol o zona: el selector sólo ofrece mensajeros de la zona;
 *   5. destino sin vehículo / no activo -> se arregla en Configuración > Usuarios;
 *   6. destino bloqueado por cierres / con recolección pendiente -> tiene que resolverlo él;
 *   7. la carrera             -> actualizar la lista y reintentar.
 */
export function traspasoConflictoMensaje(motivo: string): string {
  if (motivo.startsWith(`${MSG_ESTADO_NO_TRASPASABLE}:`)) {
    // El motivo trae el `value` del catálogo (público, no PII): se muestra su etiqueta legible.
    const value = motivo.slice(MSG_ESTADO_NO_TRASPASABLE.length + 1).trim();
    return `Alguna orden está en ${estatusLabel(value)} y no se puede traspasar: solo se traspasa lo que el mensajero lleva encima. Quítala de la selección.`;
  }
  if (motivo === MSG_ORIGEN_NO_UNICO || motivo === MSG_ORDEN_DE_OTRO_MENSAJERO) {
    return "La selección mezcla órdenes de varios mensajeros. Filtra por un solo mensajero y vuelve a seleccionarlas.";
  }
  if (motivo === MSG_ORDEN_SIN_MENSAJERO) {
    return "Alguna orden no tiene mensajero asignado: eso no es un traspaso, hay que asignarla.";
  }
  if (motivo === MSG_ORDEN_NO_EXISTE) {
    return "Alguna orden ya no existe. Actualiza la lista y vuelve a seleccionar.";
  }
  if (motivo === MSG_ORDEN_BORRADA) {
    return "Alguna orden fue eliminada. Actualiza la lista y quítala de la selección.";
  }
  if (motivo === MSG_DESTINO_IGUAL_A_ORIGEN) {
    return "Ese mensajero ya tiene estas órdenes. Elige a otro.";
  }
  if (motivo === MSG_DESTINO_NO_VALIDO) {
    return "Ese mensajero no puede recibir estas órdenes: revisa que sea mensajero de la zona de las órdenes.";
  }
  if (motivo === MSG_MENSAJERO_SIN_VEHICULO) {
    return "Ese mensajero no tiene vehículo asociado. Asígnaselo en Configuración > Usuarios y vuelve a intentarlo.";
  }
  if (motivo === MSG_MENSAJERO_NO_ASIGNABLE) {
    return "Ese mensajero no está activo. Reactívalo en Configuración > Usuarios o elige a otro.";
  }
  if (motivo === MSG_MENSAJERO_BLOQUEADO_POR_CIERRES) {
    return "Ese mensajero tiene cierres sin resolver y no puede recibir trabajo nuevo. Elige a otro o espera a que los cierre.";
  }
  if (motivo === MSG_MENSAJERO_CON_RECOLECCION) {
    return "Ese mensajero tiene una recolección en tienda pendiente y no puede además llevar reparto. Elige a otro.";
  }
  if (motivo === MSG_CARRERA_TRASPASO) {
    return "Alguna orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.";
  }
  return TRASPASO_ERROR_MESSAGES.conflict;
}

/**
 * R37: mensaje de usuario para un fallo del traspaso. Acepta el resultado completo de la acción
 * (lanzado al canal de error del `Modal`) o el `status` crudo.
 *
 * - `conflict`: se traduce el PRIMER motivo del detalle. Es todo-o-nada —el lote entero se
 *   rechazó— y pintar N mensajes en un toast no ayuda a decidir.
 * - `validation_error`: las guardas del DESTINO viajan como `fieldErrors.mensajeroDestinoId` con su
 *   constante tipada, y el catálogo incompleto como `fieldErrors.estatus`. El resto viene del zod
 *   del borde y siempre es el motivo, que es el único campo de texto del formulario.
 */
export function traspasarMensajeroErrorMessage(error: unknown): string {
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
      ? traspasoConflictoMensaje(motivo)
      : TRASPASO_ERROR_MESSAGES.conflict;
  }

  if (status === "validation_error") {
    const fieldErrors =
      objeto?.fieldErrors && typeof objeto.fieldErrors === "object"
        ? (objeto.fieldErrors as Record<string, unknown>)
        : null;
    // Catálogo de estados sin sembrar: no es un error de quien traspasa y no se arregla aquí.
    if (fieldErrors && "estatus" in fieldErrors) {
      return "Falta configuración del catálogo de estados. Contacta a un administrador.";
    }
    if (fieldErrors && "ordenIds" in fieldErrors) {
      return "Selecciona al menos una orden.";
    }
    const delDestino = fieldErrors
      ? [fieldErrors.mensajeroDestinoId].flat().find((m) => typeof m === "string")
      : undefined;
    if (typeof delDestino === "string") return traspasoConflictoMensaje(delDestino);
    return TRASPASO_ERROR_MESSAGES.validation_error;
  }

  return esTraspasoErrorStatus(status)
    ? TRASPASO_ERROR_MESSAGES[status]
    : "No se pudieron traspasar las órdenes.";
}
