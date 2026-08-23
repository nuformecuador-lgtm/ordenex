// Feature 262 (F1/F2, R19/R21) — traduce el resultado no-"ok" de la Server Action
// `corregirDiaReparto` (`lib/actions/corregir-dia-reparto.ts`) a un mensaje de usuario
// ACCIONABLE y DISTINTO por causa. Molde literal de `deshacer-asignacion-error-messages.ts`
// (149), que es el precedente exacto: misma forma de resultado y misma acción por lote.
//
// LOS MOTIVOS POR-ORDEN DEL `conflict` NO SE REESCRIBEN AQUÍ COMO LITERALES: se comparan contra
// las constantes tipadas de `lib/services/mensajes-correccion-dia-reparto.ts`. Ese módulo son
// constantes puras (sin Prisma ni `next/`), así que es seguro importarlo desde un componente de
// cliente. Un literal duplicado entre servicio, test y pantalla diverge a la primera corrección
// de estilo y nadie compara los tres a mano.
//
// ⚠️ R19 ES EL CORAZÓN DE ESTE ARCHIVO, y tiene una historia: «Actualiza la lista y vuelve a
// intentarlo» mostrado cuando reintentar NO arregla nada es el mensaje falso que originó la
// investigación de la ficha 241. Aquí cada orden rechazada dice POR QUÉ, y el que sí se puede
// reintentar (la carrera) es el ÚNICO que invita a reintentar.
//
// SIN PII Y SIN IDENTIFICADORES INTERNOS: el único dato variable que sale a pantalla es el
// `value` del catálogo de estados, que es público, y se pinta con su etiqueta legible.

import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ESTADO_SIN_DIA_VIVO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_DIA,
  MSG_SIN_MENSAJERO,
  MSG_YA_ES_ESE_DIA,
} from "@/lib/services/mensajes-correccion-dia-reparto";

import { estatusLabel } from "./estatus-label";

/**
 * R21 — cotas del motivo. ESPEJO EXACTO del zod de SU PROPIO borde
 * (`lib/actions/corregir-dia-reparto.ts`: `trim().min(10).max(300)`), no una importación desde
 * el módulo de «deshacer»: son dos bordes distintos, y atarlos haría que relajar uno relajara la
 * pantalla del otro sin que nadie lo viera. Que hoy coincidan es una decisión (design §7.2:
 * «mismo campo y mismas cotas»), no una dependencia.
 *
 * La UI valida ANTES de llamar para no ofrecer una acción que el servidor va a rechazar; el
 * servidor sigue siendo la guardia real.
 */
export const MOTIVO_MIN_LEN = 10;
export const MOTIVO_MAX_LEN = 300;

/** Textos del campo de motivo, fuera del JSX: listos para i18n. */
export const MOTIVO_LABEL = "Motivo";
export const MOTIVO_PLACEHOLDER =
  "Ej.: la bodega marcó el lote para el día equivocado al asignarlo";
export const MOTIVO_AYUDA = `Obligatorio, entre ${MOTIVO_MIN_LEN} y ${MOTIVO_MAX_LEN} caracteres. Queda guardado junto al cambio, con tu nombre.`;
export const MOTIVO_INVALIDO = `Escribe un motivo de al menos ${MOTIVO_MIN_LEN} caracteres (máximo ${MOTIVO_MAX_LEN}).`;

/** R21: ¿el motivo, ya recortado, cae dentro de las cotas del borde? */
export function motivoValido(motivo: string): boolean {
  const limpio = motivo.trim();
  return limpio.length >= MOTIVO_MIN_LEN && limpio.length <= MOTIVO_MAX_LEN;
}

type CorregirErrorStatus =
  | "forbidden"
  | "sin_zona"
  | "conflict"
  | "validation_error"
  | "unauthenticated";

/**
 * Mensaje por `status`. `forbidden` cubre las dos causas de autorización del service —rol no
 * autorizado y orden de zona ajena para el `adminSatelite`—: el servidor no las distingue en la
 * respuesta, a propósito, para no revelar qué órdenes existen fuera de tu zona (R11).
 *
 * ⚠️ El texto de `conflict` es un ÚLTIMO RECURSO y no debería verse nunca: el `conflict` real
 * trae detalle POR ORDEN y la pantalla lo pinta orden a orden (R19). Sólo se usa si el detalle
 * llegara vacío o con una forma inesperada.
 */
const CORREGIR_ERROR_MESSAGES: Record<CorregirErrorStatus, string> = {
  forbidden:
    "No tienes permiso para cambiar el día de reparto de estas órdenes. Revisa que todas sean de tu zona.",
  sin_zona:
    "No tienes una zona asignada. Pide a un administrador que te asigne una zona.",
  conflict: "No se pudo cambiar el día de reparto de este lote.",
  validation_error: MOTIVO_INVALIDO,
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
};

function isCorregirErrorStatus(value: unknown): value is CorregirErrorStatus {
  return typeof value === "string" && value in CORREGIR_ERROR_MESSAGES;
}

/**
 * R19 — mensaje accionable para UN motivo tipado del `conflict`, el de UNA orden concreta.
 *
 * Cada causa tiene su propio texto y su propia salida. Sólo `MSG_CARRERA` invita a reintentar,
 * porque es el único donde reintentar arregla algo: en los demás la orden está como está y
 * volver a pulsar produciría el mismo rechazo.
 *
 * SIN SIGLAS Y SIN NOMBRES DE COLUMNA: no dice `fecha_reparto`, ni «reserva», ni «corte».
 */
export function corregirDiaRepartoConflictoMensaje(motivo: string): string {
  if (motivo === MSG_ORDEN_NO_EXISTE) {
    return "Esta orden ya no existe. Actualiza la lista y vuelve a seleccionar.";
  }
  if (motivo === MSG_ORDEN_BORRADA) {
    return "Esta orden fue eliminada. Actualiza la lista y quítala de la selección.";
  }
  if (motivo === MSG_SIN_MENSAJERO) {
    return "Esta orden no tiene mensajero asignado. Primero asígnale uno: el día de reparto sólo se corrige sobre órdenes ya asignadas.";
  }
  if (motivo === MSG_SIN_DIA) {
    return "Esta orden no tiene día de reparto, así que no hay ninguno que corregir. Quítala de la selección.";
  }
  if (motivo === MSG_YA_ES_ESE_DIA) {
    return "Esta orden ya está marcada para el día que elegiste. Elige el otro día o quítala de la selección.";
  }
  if (motivo.startsWith(`${MSG_ESTADO_SIN_DIA_VIVO}:`)) {
    // El motivo trae el `value` del catálogo (público, no PII): se muestra su etiqueta legible.
    const value = motivo.slice(MSG_ESTADO_SIN_DIA_VIVO.length + 1).trim();
    return `El día de reparto ya no decide nada para esta orden (${estatusLabel(value)}). Quítala de la selección.`;
  }
  if (motivo === MSG_CARRERA) {
    // El ÚNICO que invita a reintentar, porque es el único donde reintentar sirve.
    return "Esta orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.";
  }
  if (motivo === MSG_CATALOGO_INCOMPLETO) {
    return "Falta configuración del catálogo de estados. Contacta a un administrador.";
  }
  return CORREGIR_ERROR_MESSAGES.conflict;
}

/**
 * Motivos por orden de un `conflict`, o `null` si el error no es un `conflict` con detalle.
 *
 * Devuelve `null` —y no una lista vacía— para que la pantalla pueda distinguir «esto es un
 * rechazo por orden, píntalo orden a orden» de «esto es otra cosa, va al canal de error»
 * (R19). Un `conflict` con `detalle: []` no existe por contrato (el todo-o-nada nombra siempre
 * la orden que falló), pero si llegara, se trata como «otra cosa» en vez de pintar una lista
 * vacía que parecería un éxito silencioso.
 */
export function detalleDeConflicto(
  error: unknown,
): { ordenId: string; motivo: string }[] | null {
  if (!error || typeof error !== "object") return null;
  const objeto = error as Record<string, unknown>;
  if (objeto.status !== "conflict") return null;
  const detalle = objeto.detalle;
  if (!Array.isArray(detalle) || detalle.length === 0) return null;
  const entradas = detalle.filter(
    (d): d is { ordenId: string; motivo: string } =>
      !!d &&
      typeof d === "object" &&
      typeof (d as { ordenId?: unknown }).ordenId === "string" &&
      typeof (d as { motivo?: unknown }).motivo === "string",
  );
  return entradas.length > 0 ? entradas : null;
}

/**
 * R19 — mensaje de usuario para un fallo que NO es un `conflict` con detalle (los que sí lo son
 * se pintan orden a orden, no en un toast). Acepta el resultado completo de la acción o el
 * `status` crudo.
 */
export function corregirDiaRepartoErrorMessage(error: unknown): string {
  const objeto = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = objeto && "status" in objeto ? objeto.status : error;

  if (status === "conflict") {
    // Sólo se llega aquí si el detalle no vino o vino con otra forma: el camino normal del
    // `conflict` no pasa por esta función.
    const detalle = detalleDeConflicto(error);
    return detalle
      ? corregirDiaRepartoConflictoMensaje(detalle[0].motivo)
      : CORREGIR_ERROR_MESSAGES.conflict;
  }

  if (status === "validation_error") {
    const fieldErrors = objeto?.fieldErrors;
    const primero =
      fieldErrors && typeof fieldErrors === "object"
        ? Object.values(fieldErrors as Record<string, unknown>).flat()[0]
        : undefined;
    // La guarda de CONFIGURACIÓN del service (catálogo de estados) viaja como `fieldError` con
    // su constante tipada; el resto de `validation_error` viene del zod del borde.
    if (primero === MSG_CATALOGO_INCOMPLETO) {
      return corregirDiaRepartoConflictoMensaje(MSG_CATALOGO_INCOMPLETO);
    }
    return CORREGIR_ERROR_MESSAGES.validation_error;
  }

  return isCorregirErrorStatus(status)
    ? CORREGIR_ERROR_MESSAGES[status]
    : "No se pudo cambiar el día de reparto.";
}
