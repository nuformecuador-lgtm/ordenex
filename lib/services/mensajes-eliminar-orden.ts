// Feature «eliminar orden» — motivos TIPADOS del rechazo por orden. Mismo patron que
// `mensajes-deshacer-asignacion.ts`: el service, los tests y la UI comparan contra ESTAS
// constantes y no contra literales duplicados en tres sitios.
//
// Ninguno expone identificadores internos ni datos del destinatario: el `ordenId` viaja en el
// campo `ordenId` del detalle, para senalar la fila, nunca dentro del texto.

/** El identificador del lote no corresponde a ninguna orden. */
export const MSG_ORDEN_NO_EXISTE = "orden no existe";

/** La orden ya estaba borrada (`deleted_at` no nulo): el borrado es idempotente, pero se avisa. */
export const MSG_ORDEN_YA_BORRADA = "orden ya borrada";

// ---------------------------------------------------------------------------------------
// AMPLIACION (pedido humano 2026-08-27) — este modulo pasa a cubrir las DOS caras de
// `deleted_at`: el borrado y su REVERSION. Sigue siendo constantes puras (sin Prisma ni
// `next/`), asi que la UI las puede importar; y sigue sin exponer identificadores internos.
// ---------------------------------------------------------------------------------------

/**
 * El ESTADO de la orden no admite eliminarla.
 *
 * FICHA 319 (2026-08-28) — se llamaba `MSG_ORDEN_CON_GESTION` y decia «orden con gestion
 * posterior a la creacion», que era literalmente el criterio de entonces: contar transiciones
 * en `orden_historial_estado`. Ese conteo SE RETIRO (decision del humano: el estado ya dice
 * quien hizo que con el paquete, y el conteo descalificaba una orden solo por haberle impreso
 * la etiqueta). El nombre y el texto se mueven con el criterio, en vez de quedarse citando una
 * regla que ya no se aplica: el siguiente que lea este motivo en un `conflict` deduciria que el
 * rechazo salio del historial, y saldria de la lista de
 * `lib/types/order-status-eliminables.ts`.
 *
 * Sigue sin exponer identificadores internos ni datos del destinatario. Tampoco nombra el
 * estado concreto: el motivo va por orden y la fila ya muestra su estatus en pantalla.
 */
export const MSG_ORDEN_NO_ELIMINABLE = "orden en un estado que no admite eliminarla";

/**
 * La orden tiene al menos UN intento de entrega (pedido humano 2026-09-04, la segunda mitad del
 * criterio).
 *
 * MOTIVO PROPIO Y NO UN `MSG_ORDEN_NO_ELIMINABLE` mas, aunque los dos acaben en el mismo
 * `conflict`: son dos rechazos con acciones distintas para quien los lee. «Estado que no admite
 * eliminarla» se puede resolver esperando o moviendo la orden; «ya se intento entregar» no se
 * resuelve nunca —el conteo de intentos es MONOTONO CRECIENTE por contrato de la feature 215—.
 * Colapsarlos haria que el operador reintentara indefinidamente sobre una orden que jamas sera
 * borrable.
 *
 * No nombra el numero de intentos ni el estado: el motivo va por orden y la fila ya muestra
 * ambos en pantalla. Sigue sin exponer identificadores internos ni datos del destinatario.
 */
export const MSG_ORDEN_CON_INTENTOS = "orden con intentos de entrega";

/**
 * La orden NO esta borrada (`deleted_at` nulo): no hay nada que recuperar. Es el espejo
 * exacto de `MSG_ORDEN_YA_BORRADA`, y existe por la misma razon — distinguir "no existe" de
 * "no procede" en vez de devolver un `conflict` mudo.
 */
export const MSG_ORDEN_NO_BORRADA = "orden no borrada";
