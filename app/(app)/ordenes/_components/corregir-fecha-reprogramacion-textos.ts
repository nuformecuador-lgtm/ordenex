// FICHA 371 (UI) — los TEXTOS de «corregir la fecha de una reprogramación», fuera del JSX y en un
// solo archivo: listos para i18n y comparables de un vistazo.
//
// Molde: `corregir-dia-reparto-error-messages.ts` (262), que es el precedente exacto —misma
// operación, otra columna—. De él se copia la disciplina, no los literales:
//
//   · LOS MOTIVOS DEL `conflict` NO SE REESCRIBEN AQUÍ COMO LITERALES. Se comparan contra las
//     constantes tipadas de `lib/services/mensajes-correccion-fecha-reprogramacion.ts`, que son
//     constantes puras (sin Prisma ni `next/`) y por eso se pueden importar desde un componente de
//     cliente. Tres copias del mismo literal divergen a la primera corrección de estilo.
//   · CADA RECHAZO DICE POR QUÉ y sólo la carrera invita a reintentar: reintentar los demás
//     produce el mismo rechazo. Es la lección de la ficha 241.
//   · SIN SIGLAS, SIN NOMBRES DE COLUMNA Y SIN `YYYY-MM-DD` A LA VISTA: las fechas se ponen en
//     palabras con `fechaLegible`, la misma función que usa la 262.
//
// ⭑ LO MÁS IMPORTANTE DE ESTE ARCHIVO SON LOS TRES DESENLACES (`textoDesenlace`). El backend
// devuelve `liberacion: "liberada" | "espera_cierre" | "espera_fecha"` justamente para que la
// pantalla los CUENTE. Si corregir a hoy dijera sólo «listo» y el coordinador viera la orden igual
// de bloqueada, habríamos cambiado una confusión por otra — que es lo que esta ficha viene a
// quitar. Por eso los tres tienen mensaje propio y `espera_cierre` dice QUÉ FALTA, no sólo que no
// se pudo.
import type { DesenlaceLiberacion } from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ESTADO_NO_REPROGRAMADA,
  MSG_FECHA_INVALIDA,
  MSG_MOTIVO_REQUERIDO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_FECHA,
  MSG_SIN_GESTION,
  MSG_YA_ES_ESA_FECHA,
} from "@/lib/services/mensajes-correccion-fecha-reprogramacion";
import { fechaLegible } from "@/lib/utils/dia-reparto-textos";

import { estatusLabel } from "./estatus-label";

// ---------------------------------------------------------------------------
// La acción y el modal
// ---------------------------------------------------------------------------

/**
 * ⚠️ ES EL MISMO TEXTO QUE EL BOTÓN DE LA BARRA Y QUE EL TÍTULO DEL MODAL, y por eso se declara
 * una sola vez (misma razón que `CAMBIAR_DIA_ACCION` en la 262): dos literales iguales en dos
 * archivos divergen, y entonces se pulsa un botón y se abre un modal que se llama otra cosa.
 */
export const CORREGIR_FECHA_ACCION = "Corregir fecha de reprogramación";

/** Verbo del botón que escribe. Distinto del título: dice lo que va a pasar al pulsarlo. */
export const CORREGIR_FECHA_CONFIRMAR = "Corregir fecha";

export const CORREGIR_FECHA_DESCRIPCION =
  "Cambia la fecha para la que quedó reprogramada esta orden. No cambia el mensajero, ni el estado, ni la guía.";

/** Se corrige DE UNA EN UNA: el rastro y el motivo describen esta orden, no un lote. */
export const CORREGIR_FECHA_UNA_SOLA =
  "Esta corrección se hace de una orden a la vez. Deja marcada solo la que quieres corregir.";

export const CORREGIR_FECHA_SIN_ORDEN = "Selecciona una orden para corregir su fecha.";

// ---------------------------------------------------------------------------
// La fecha actual, ANTES de corregir
// ---------------------------------------------------------------------------

/**
 * La fecha para la que la orden está reprogramada HOY, en palabras. Sale de `fechaReprogramacion`
 * del DTO del listado, YA RESUELTA EN EL SERVIDOR (la misma que pinta la columna «Reprogramada
 * para» de la ficha 367): aquí no se interpreta ninguna fecha ni se lee ningún reloj — hacerlo
 * reintroduciría el off-by-one de zona horaria que `lib/utils/fecha-cr.ts` documenta.
 *
 * Sin este dato se corrige A CIEGAS, que es exactamente cómo se llega a la SEGUNDA fecha
 * equivocada. La 262 añadió `fechaRepartoISO` al DTO por esta misma razón.
 */
export function avisoFechaActual(fechaISO: string | null | undefined): string {
  if (!fechaISO) return "Esta orden no tiene una fecha de reprogramación registrada.";
  return `Ahora está reprogramada para el ${fechaLegible(fechaISO)}.`;
}

// ---------------------------------------------------------------------------
// El campo de fecha
// ---------------------------------------------------------------------------

export const FECHA_LABEL = "Nueva fecha";

/**
 * ⚠️ EL MÍNIMO ES HOY, NO MAÑANA, y es la razón de ser de la ficha. El registro original de una
 * reprogramación exige «mañana o posterior»; la CORRECCIÓN admite el día en curso, porque el caso
 * real que la origina es corregir del 4 al 3 ESTANDO A DÍA 3. El borde ya lo valida así
 * (`fechaCorreccionSchema`); esta pantalla NO puede ser más estricta que él o volvería a bloquear
 * justo el caso que venimos a resolver.
 */
export const FECHA_AYUDA = "Puede ser hoy: al corregir sí se admite el día en curso.";

export const FECHA_INVALIDA = "La fecha debe ser hoy o posterior.";

// ---------------------------------------------------------------------------
// El motivo
// ---------------------------------------------------------------------------

export const MOTIVO_LABEL = "Motivo";
export const MOTIVO_PLACEHOLDER = "Ej.: el mensajero marcó el día equivocado al reprogramar";

/**
 * Decisión del humano (2026-09-03): «el motivo sí tiene que ir, básicamente es la misma gestión
 * que reprogramar». Por eso la regla es la de reprogramar —NO VACÍO— y NO el mínimo de 10
 * caracteres de la 262: aquélla tiene su propia regla y aquí el criterio es «igual que
 * reprogramar». El borde valida lo mismo (`motivoSchema`, que recorta antes de medir).
 */
export const MOTIVO_AYUDA = "Obligatorio. Queda guardado junto al cambio, con tu nombre.";
export const MOTIVO_INVALIDO = "Escribe el motivo de la corrección.";

/** Espejo del `motivoSchema` del borde: recortar y exigir que quede algo. */
export function motivoValido(motivo: string): boolean {
  return motivo.trim().length > 0;
}

// ---------------------------------------------------------------------------
// ⭑ LOS TRES DESENLACES
// ---------------------------------------------------------------------------

/** «Del 4 de septiembre al 3 de septiembre», sin `YYYY-MM-DD` a la vista. */
function cambioEnPalabras(anteriorISO: string, nuevaISO: string): string {
  return `Fecha corregida: del ${fechaLegible(anteriorISO)} al ${fechaLegible(nuevaISO)}.`;
}

/**
 * ⭑ QUÉ LE PASÓ A LA ORDEN. Los tres valores de `liberacion` significan cosas distintas para quien
 * corrige, así que los tres tienen un mensaje propio:
 *
 *   · `liberada`      — volvió a la bodega en el acto; ya se le puede asignar mensajero.
 *   · `espera_cierre` — la fecha ya venció, pero la orden SIGUE RETENIDA. El mensaje dice QUÉ
 *                       FALTA —que se apruebe el cierre donde se reportó esa reprogramación—, no
 *                       sólo que no se pudo: la puerta que la retiene existe para que la orden no
 *                       vuelva con el contador de intentos atrasado, y sin explicación el
 *                       coordinador miraría el listado, vería la orden igual de bloqueada y no
 *                       entendería nada.
 *   · `espera_fecha`  — se corrigió a un día futuro y espera al calendario. Es lo correcto: la
 *                       fecha de reprogramación es un compromiso con el destinatario.
 */
export function textoDesenlace(
  liberacion: DesenlaceLiberacion,
  fechaAnteriorISO: string,
  fechaNuevaISO: string,
): string {
  const cambio = cambioEnPalabras(fechaAnteriorISO, fechaNuevaISO);
  if (liberacion === "liberada") {
    return `${cambio} La orden ya volvió a la bodega y se le puede asignar mensajero.`;
  }
  if (liberacion === "espera_cierre") {
    return `${cambio} La orden todavía NO vuelve a la bodega: falta que se apruebe el cierre donde el mensajero reportó esa reprogramación. En cuanto se apruebe, la orden vuelve sola.`;
  }
  return `${cambio} La orden espera a ese día: vuelve sola a la bodega cuando llegue.`;
}

/** Tono del aviso del desenlace. `espera_cierre` NO es un éxito redondo y no se pinta como tal. */
export function tonoDesenlace(liberacion: DesenlaceLiberacion): "ok" | "aviso" | "espera" {
  if (liberacion === "liberada") return "ok";
  if (liberacion === "espera_cierre") return "aviso";
  return "espera";
}

// ---------------------------------------------------------------------------
// Los rechazos
// ---------------------------------------------------------------------------

const ERROR_GENERICO = "No se pudo corregir la fecha de esta reprogramación.";

/**
 * Mensaje para UN motivo tipado del `conflict`. Cada causa dice por qué y cuál es la salida; sólo
 * `MSG_CARRERA` invita a reintentar, porque es el único donde reintentar arregla algo.
 *
 * El único dato variable que sale a pantalla es el `value` del catálogo de estados —público, no
 * dato personal—, y se pinta con su etiqueta legible.
 */
export function corregirFechaConflictoMensaje(motivo: string): string {
  if (motivo === MSG_ORDEN_NO_EXISTE) {
    return "Esta orden ya no existe. Actualiza la lista.";
  }
  if (motivo === MSG_ORDEN_BORRADA) {
    return "Esta orden fue eliminada. Actualiza la lista.";
  }
  if (motivo === MSG_SIN_GESTION) {
    return "Esta orden no tiene una reprogramación vigente que corregir. Avisa a un administrador.";
  }
  if (motivo === MSG_SIN_FECHA) {
    return "La reprogramación de esta orden no fijó ninguna fecha, así que no hay nada que corregir.";
  }
  if (motivo === MSG_YA_ES_ESA_FECHA) {
    return "La orden ya está reprogramada para esa fecha. Elige otra.";
  }
  if (motivo.startsWith(`${MSG_ESTADO_NO_REPROGRAMADA}:`)) {
    const value = motivo.slice(MSG_ESTADO_NO_REPROGRAMADA.length + 1).trim();
    return `Esta orden ya no está esperando una reprogramación (${estatusLabel(value)}), así que su fecha ya no decide nada. Actualiza la lista.`;
  }
  if (motivo === MSG_CARRERA) {
    return "Esta orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.";
  }
  if (motivo === MSG_CATALOGO_INCOMPLETO) {
    return "Falta configuración del catálogo de estados. Contacta a un administrador.";
  }
  if (motivo === MSG_FECHA_INVALIDA) return FECHA_INVALIDA;
  if (motivo === MSG_MOTIVO_REQUERIDO) return MOTIVO_INVALIDO;
  return ERROR_GENERICO;
}

/**
 * Mensaje para un resultado que no es `ok`. Acepta el resultado completo de la Server Action.
 *
 * `validation_error` se traduce POR CAMPO: el borde nombra `fecha`, `motivo`, `ordenId` o
 * `estatus`, y decir «revisa el formulario» cuando el servidor ya dijo cuál campo está mal sería
 * esconder la respuesta que ya tenemos.
 */
export function corregirFechaErrorMensaje(error: unknown): string {
  const objeto = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const status = objeto && "status" in objeto ? objeto.status : error;

  if (status === "conflict") {
    const motivo = objeto?.motivo;
    return typeof motivo === "string" ? corregirFechaConflictoMensaje(motivo) : ERROR_GENERICO;
  }
  if (status === "forbidden") {
    return "No tienes permiso para corregir la fecha de una reprogramación.";
  }
  if (status === "unauthenticated") {
    return "Tu sesión expiró. Inicia sesión de nuevo.";
  }
  if (status === "validation_error") {
    const fieldErrors = objeto?.fieldErrors;
    const campos =
      fieldErrors && typeof fieldErrors === "object"
        ? (fieldErrors as Record<string, unknown>)
        : {};
    if ("fecha" in campos) return FECHA_INVALIDA;
    if ("motivo" in campos) return MOTIVO_INVALIDO;
    // La guarda de CONFIGURACIÓN del service viaja como `fieldError` con su constante tipada.
    const primero = Object.values(campos).flat()[0];
    if (primero === MSG_CATALOGO_INCOMPLETO) {
      return corregirFechaConflictoMensaje(MSG_CATALOGO_INCOMPLETO);
    }
    return ERROR_GENERICO;
  }
  return ERROR_GENERICO;
}
