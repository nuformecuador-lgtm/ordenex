// FICHA 371 — motivos TIPADOS y compartidos del rechazo de «corregir la fecha de una
// reprogramación». Patrón `lib/services/mensajes-correccion-dia-reparto.ts` (262): el service, los
// tests y la pantalla asertan y traducen sobre ESTAS constantes, no sobre literales duplicados en
// tres sitios.
//
// POR QUÉ CADA RECHAZO TIENE SU MOTIVO Y NO HAY UNO GENÉRICO: el mensaje falso «vuelve a
// intentarlo» —mostrado cuando reintentar no arregla nada— es el que originó la investigación de la
// ficha 241. Aquí cada rechazo dice POR QUÉ, y el estado se NOMBRA.
//
// SIN PII y SIN IDENTIFICADORES INTERNOS: el único dato variable que aparece es el `value` del
// catálogo de estados (`en_reparto`, `entregada`, …), que es público y no es PII. Ni UUIDs, ni
// teléfono, ni destinatario, ni la fecha de nadie.

/** El identificador no corresponde a ninguna orden. */
export const MSG_ORDEN_NO_EXISTE = "orden no existe";

/** La orden está borrada (`deleted_at` no nulo). */
export const MSG_ORDEN_BORRADA = "orden borrada";

/** Prefijo del motivo de estado no admitido; `msgEstadoNoReprogramada` lo compone. */
export const MSG_ESTADO_NO_REPROGRAMADA = "la orden ya no está esperando una reprogramación";

/**
 * La corrección se ofrece SÓLO mientras la orden sigue en `reprogramada`, que es exactamente
 * mientras esa fecha decide algo: es la que el cron de las 00:00 CR mira para devolverla a bodega.
 * En cualquier otro estado la orden ya volvió a circular y mover la fecha no cambiaría nada — sería
 * escribir un dato muerto.
 */
export function msgEstadoNoReprogramada(estatusValue: string): string {
  return `${MSG_ESTADO_NO_REPROGRAMADA}: ${estatusValue}`;
}

/**
 * La orden está en `reprogramada` pero no tiene ninguna gestión `reprogramada` vigente que
 * corregir. Es un estado incoherente que la corrección NO arregla: crear la gestión que falta sería
 * inventar un hecho operativo que nunca ocurrió.
 */
export const MSG_SIN_GESTION = "la orden no tiene una reprogramación vigente que corregir";

/** La gestión vigente no fijó fecha: no hay nada que corregir, y el rastro la exige. */
export const MSG_SIN_FECHA = "la reprogramación no tiene fecha, así que no hay nada que corregir";

/** Escribir una corrección que no corrige nada. Lo impide además un CHECK en la base. */
export const MSG_YA_ES_ESA_FECHA = "la reprogramación ya está fijada para esa fecha";

/**
 * La orden o su gestión cambiaron entre la validación y el `UPDATE` (alguien la deshizo, la liberó
 * el cron, o llegó una gestión más nueva). No se escribió nada.
 */
export const MSG_CARRERA = "la orden cambió antes de completar la corrección";

/** Guardia de seed: falta el `value` `reprogramada` en el catálogo de estados. */
export const MSG_CATALOGO_INCOMPLETO = "catalogo de estados incompleto (seed pendiente)";

/** Borde: la fecha no es un día válido, o es anterior a hoy en el calendario de Costa Rica. */
export const MSG_FECHA_INVALIDA = "la fecha debe ser hoy o posterior";

/** Borde: el motivo es obligatorio, exactamente igual que al reprogramar. */
export const MSG_MOTIVO_REQUERIDO = "motivo requerido";
