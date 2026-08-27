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
 * La orden ya registra al menos UNA gestion posterior a su creacion, asi que no se puede
 * eliminar. "Gestion" aqui es lo que el sistema entiende por tal en su unica evidencia
 * auditable: una transicion de estado con origen (`orden_historial_estado` con
 * `estatus_origen_id` NO nulo). La fila de nacimiento tiene ese campo NULO y por tanto no
 * cuenta — es la creacion, no una gestion posterior a ella.
 */
export const MSG_ORDEN_CON_GESTION = "orden con gestion posterior a la creacion";

/**
 * La orden NO esta borrada (`deleted_at` nulo): no hay nada que recuperar. Es el espejo
 * exacto de `MSG_ORDEN_YA_BORRADA`, y existe por la misma razon — distinguir "no existe" de
 * "no procede" en vez de devolver un `conflict` mudo.
 */
export const MSG_ORDEN_NO_BORRADA = "orden no borrada";
