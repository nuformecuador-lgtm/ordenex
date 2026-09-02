// Feature 149 (design §3.4) — motivos TIPADOS y compartidos del rechazo de "deshacer
// asignacion". Patron `lib/services/mensajes-bloqueo.ts` (feature 46): el service, los tests y
// la UI aserten/traduzcan sobre ESTAS constantes y no sobre literales duplicados en tres sitios.
//
// R40: ninguno de estos textos incluye identificadores internos (UUID de orden, de estado o de
// usuario) ni datos personales del destinatario. El unico dato variable que aparece es el
// `value` del catalogo de estados (`por_recoger`, `en_reparto`, ...), que es publico y no es PII.
//
// NO EXISTE, deliberadamente, una constante de "mensajero con cierre pendiente": por la
// decision Q1 del gate F1.4 (CERRADA, R19) el cierre pendiente NO bloquea el deshacer, asi que
// ese motivo no puede producirse en esta feature. Ver `design.md` §8-Q1.

/** R18: el identificador del lote no corresponde a ninguna orden. */
export const MSG_ORDEN_NO_EXISTE = "orden no existe";

/** R17: la orden esta borrada (`deleted_at` no nulo). */
export const MSG_ORDEN_BORRADA = "orden borrada";

/**
 * R13 (fallo CERRADO): no se pudo derivar el estado de origen del historial — no hay fila cuyo
 * destino sea el estado actual, la fila es de creacion (origen NULL) o el origen leido no
 * pertenece a la tabla de normalizacion (D3'). NUNCA se adivina un destino.
 */
export const MSG_SIN_HISTORIAL =
  "no se pudo derivar el estado de origen del historial de la orden";

/**
 * FICHA 363 — R14/R15 REESCRITOS. La normalizacion sigue siendo una INFERENCIA y se sigue
 * VERIFICANDO, pero contra el INVENTARIO CERRADO DE TRANSICIONES de la 140 (las aristas cuya
 * familia es `deshacer_asignacion`), no contra la zona de la orden.
 *
 * POR QUE SE FUE LA ZONA: la zona dice a que bodega PERTENECE la orden, no donde esta el
 * paquete. Una orden de zona satelite VIVE en la bodega central mientras espera ruteo —es el
 * flujo normal, no una anomalia—, asi que «destino `en_bodega_central` + orden no-central» es
 * el caso COMUN y rechazarlo hacia imposible deshacer el ruteo de cualquier satelite (medido en
 * produccion: las 94 ordenes vivas de Guanacaste, las 17 guias reportadas incluidas).
 */
export const MSG_DESTINO_NO_DECLARADO =
  "el destino derivado no es una reversion declarada para el estado actual de la orden";


/** R16: prefijo del motivo de estado no reversible; `msgEstadoNoReversible` lo compone. */
export const MSG_ESTADO_NO_REVERSIBLE = "estado no reversible";

/**
 * R16: motivo que NOMBRA el estado actual de la orden (`en_reparto`, `en_bodega_satelite`,
 * `entregada`, ...). Solo estados de origen `por_recoger` y `en_ruta_bodega_satelite` son
 * reversibles.
 */
export function msgEstadoNoReversible(estatusValue: string): string {
  return `${MSG_ESTADO_NO_REVERSIBLE}: ${estatusValue}`;
}

/**
 * R21: la orden perdio la guarda de escritura por estado de origen (carrera con la recogida,
 * la recepcion satelite o el corte diario) — el lote completo se revierte.
 */
export const MSG_CARRERA = "la orden cambio de estado antes de completar la reversion";

/**
 * Guardia de configuracion: la zona central (GAM) no esta configurada.
 *
 * ⚠️ FICHA 363: `DeshacerAsignacionService` YA NO LO PRODUCE. Existia unicamente para poder
 * evaluar la comparacion contra la zona central que la 363 retira; sin esa comparacion, exigir
 * la zona central configurada era un bloqueo que no protegia nada. Se CONSERVA exportado porque
 * la capa de presentacion lo importa y traduce (fuera de alcance), y porque el motivo sigue
 * siendo el vocabulario comun con `GuiaAsignacionService`.
 */
export const MSG_ZONA_CENTRAL_NO_CONFIGURADA = "zona central no configurada";

/** Guardia de seed: falta algun `value` del catalogo de estados. */
export const MSG_CATALOGO_INCOMPLETO = "catalogo de estados incompleto (seed pendiente)";
