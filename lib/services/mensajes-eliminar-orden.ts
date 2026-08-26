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
