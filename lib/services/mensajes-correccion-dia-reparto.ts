// Feature 262 (B6, design §7.2) — motivos TIPADOS y compartidos del rechazo de «corregir el día de
// reparto». Patrón `lib/services/mensajes-deshacer-asignacion.ts` (149) y
// `lib/services/mensajes-bloqueo.ts` (46): el service, los tests y la pantalla asertan y traducen
// sobre ESTAS constantes, no sobre literales duplicados en tres sitios.
//
// POR QUÉ CADA RECHAZO TIENE SU MOTIVO Y NO HAY UNO GENÉRICO (R19). El mensaje falso
// «Actualiza la lista y vuelve a intentarlo» —mostrado cuando reintentar no arregla nada— es el que
// originó la investigación de la ficha 241. Aquí cada orden rechazada dice POR QUÉ, y el estado se
// NOMBRA (R6).
//
// SIN PII y SIN IDENTIFICADORES INTERNOS: el único dato variable que aparece es el `value` del
// catálogo de estados (`entregada`, `devuelta`, …), que es público y no es PII. Ni UUIDs, ni
// teléfono, ni destinatario.
//
// NO EXISTE, deliberadamente, una constante de «mensajero con cierre pendiente»: por R14 un cierre
// pendiente NO bloquea la corrección (regla 2 de la 241, firmada el 2026-08-20; mismo criterio con
// el que la 149 cerró su Q1), así que ese motivo no puede producirse aquí.

/** El identificador del lote no corresponde a ninguna orden. */
export const MSG_ORDEN_NO_EXISTE = "orden no existe";

/** La orden está borrada (`deleted_at` no nulo). */
export const MSG_ORDEN_BORRADA = "orden borrada";

/**
 * R5 — la orden no tiene mensajero asignado. La corrección NO asigna: exige que la orden YA esté
 * asignada, porque un día de reparto sin mensajero es un dato huérfano que el corte tendría que
 * interpretar (invariante 246/R10).
 */
export const MSG_SIN_MENSAJERO = "la orden no tiene mensajero asignado";

/**
 * R4/R5 — la orden no tiene día de reparto. Y esto NO es un hueco que rellenar: `fecha_reparto
 * IS NULL` significa algo concreto —«no está reservada para un día que aún no ha llegado»— y esas
 * órdenes cuentan en el ranking por la RAMA DE RESPALDO, la de `asignado_at`. Ponerles día las
 * movería de rama y por tanto de día en el denominador: no sería una corrección, sería una
 * asignación de día nueva disfrazada (D3'). Además no lo necesitan: una orden sin día no está
 * bloqueada por nada (261/R8).
 */
export const MSG_SIN_DIA = "la orden no tiene día de reparto, así que no hay nada que corregir";

/** R7 — la orden YA está marcada para el día elegido: escribir una corrección que no corrige nada. */
export const MSG_YA_ES_ESE_DIA = "la orden ya está marcada para el día elegido";

/** R6: prefijo del motivo de estado no admitido; `msgEstadoSinDiaVivo` lo compone. */
export const MSG_ESTADO_SIN_DIA_VIVO = "el día de reparto ya no decide nada en este estado";

/**
 * R6 — motivo que NOMBRA el estado actual de la orden. La corrección se ofrece sólo donde el día
 * TODAVÍA decide algo (`por_recoger`, `en_reparto`, `ayuda_tienda`); en cualquier otro, mover el día
 * no cambiaría ni lo que barre el corte ni en qué día cuenta la orden para el ranking.
 */
export function msgEstadoSinDiaVivo(estatusValue: string): string {
  return `${MSG_ESTADO_SIN_DIA_VIVO}: ${estatusValue}`;
}

/**
 * R9 — la orden perdió la guarda de escritura entre la validación y el `UPDATE` (alguien la recogió,
 * la gestionó, la barrió el corte o le cambió el día). El lote completo se revierte.
 */
export const MSG_CARRERA = "la orden cambió antes de completar la corrección";

/** Guardia de seed: falta algún `value` del catálogo de estados. */
export const MSG_CATALOGO_INCOMPLETO = "catalogo de estados incompleto (seed pendiente)";
