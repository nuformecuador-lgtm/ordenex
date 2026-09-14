// FICHA 427 (T14, design §7.2) — motivos TIPADOS y compartidos del rechazo del TRASPASO de ordenes
// entre mensajeros. Patron `lib/services/mensajes-deshacer-asignacion.ts` (149) y
// `lib/services/mensajes-bloqueo.ts` (46): el service, los tests y la UI afirman/traducen sobre
// ESTAS constantes y no sobre literales duplicados en tres sitios.
//
// R37: ninguno de estos textos incluye identificadores internos (uuid de orden, de estado o de
// usuario) ni datos personales del destinatario de la orden. El unico dato variable que aparece es
// el `value` del catalogo de estados (`en_reparto`, `por_recoger`, ...), que es publico y no es PII.
//
// ⚠️ LOS CUATRO MOTIVOS QUE **NO** NACEN AQUI SE IMPORTAN, NO SE COPIAN. Son la misma regla que ya
// aplican las dos asignaciones, y dos literales gemelos es exactamente como se desincronizan dos
// pantallas que cuentan la misma cosa (el incidente del 2026-08-18 de este repo). Se re-exportan
// para que quien traduzca el error del traspaso tenga UN solo sitio del que importar:
//
//   · `MSG_MENSAJERO_SIN_VEHICULO`          (21)      -> R10
//   · `MSG_MENSAJERO_NO_ASIGNABLE`          (2026-08-26) -> R10
//   · `MSG_MENSAJERO_BLOQUEADO_POR_CIERRES` (271)     -> R11
//   · `MSG_MENSAJERO_CON_RECOLECCION`       (157)     -> R13
//
// Y lo mismo con «orden no existe» / «orden borrada», que vienen del vocabulario de la 149.
import {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_CON_RECOLECCION,
  MSG_MENSAJERO_NO_ASIGNABLE,
  MSG_MENSAJERO_SIN_VEHICULO,
} from "@/lib/services/mensajes-bloqueo";
import { MSG_ORDEN_BORRADA, MSG_ORDEN_NO_EXISTE } from "@/lib/services/mensajes-deshacer-asignacion";

export {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_CON_RECOLECCION,
  MSG_MENSAJERO_NO_ASIGNABLE,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
};

/** R5: prefijo del motivo de estado no traspasable; `msgEstadoNoTraspasable` lo compone. */
export const MSG_ESTADO_NO_TRASPASABLE = "estado no traspasable";

/**
 * R4/R5 — motivo que NOMBRA el estado actual de la orden (`por_recoger`, `devolviendo_a_tienda`,
 * `sin_gestionar`, `entregada`, ...). Solo `en_reparto` y `ayuda_tienda` son traspasables: en los
 * demas o el paquete no esta en la mano del mensajero, o moverlo afirmaria una custodia que nadie
 * verifico.
 *
 * NOMBRA EL ESTADO y no dice «no se puede» a secas, porque el operador tiene que poder decidir QUE
 * hacer con esa orden: una `por_recoger` se deshace y se reasigna (149), una `devolviendo_a_tienda`
 * es un problema de donde esta la caja, y una `sin_gestionar` pertenece al cierre de su mensajero.
 */
export function msgEstadoNoTraspasable(estatusValue: string): string {
  return `${MSG_ESTADO_NO_TRASPASABLE}: ${estatusValue}`;
}

/**
 * R6 — el lote mezcla ordenes de mas de un mensajero de origen.
 *
 * Se rechaza el lote ENTERO y no «las que no son del primero»: un lote con dos origenes no tiene
 * caso de uso, deja la confirmacion de R35 sin poder decir «de quien a quien» y haria ambiguo el
 * encolado de reoptimizacion (habria que reoptimizar N rutas de origen). El motivo NO nombra a
 * ninguno de los dos mensajeros: quien traspasa ve la columna «Mensajero» en el listado.
 */
export const MSG_ORIGEN_NO_UNICO =
  "el lote mezcla ordenes de varios mensajeros: selecciona las de uno solo";

/** R5/R6: la orden esta en un estado traspasable pero pertenece a OTRO mensajero del lote. */
export const MSG_ORDEN_DE_OTRO_MENSAJERO = "la orden es de otro mensajero";

/** R4/R5: la orden no tiene mensajero asignado — no hay traspaso posible, hay que ASIGNARLA. */
export const MSG_ORDEN_SIN_MENSAJERO = "la orden no tiene mensajero asignado: hay que asignarla";

/**
 * R7 — el mensajero destino es el mismo que el de origen. La UI ya lo excluye del selector, el
 * servicio lo rechaza aqui y el CHECK `orden_traspaso_mensajero_distinto_check` lo hace
 * inescribible: tres redes, y la ultima esta en la base.
 */
export const MSG_DESTINO_IGUAL_A_ORIGEN = "el mensajero destino es el mismo que ya tiene la orden";

/**
 * R9 — el destino no es un mensajero, o no pertenece a la zona de alguna de las ordenes del lote.
 *
 * UN SOLO MOTIVO PARA LAS DOS CAUSAS, a proposito y con precedente (`mensajeroId no valido` de
 * `GuiaAsignacionService`): distinguirlas le diria a quien traspasa en que zona esta cada usuario
 * del sistema, y no hace falta para arreglarlo — el selector solo ofrece mensajeros de la zona.
 */
export const MSG_DESTINO_NO_VALIDO = "mensajero destino no valido";

/**
 * R24 — la orden perdio su guarda de escritura entre la validacion y la transaccion: alguien la
 * entrego, pidio ayuda sobre ella, se la llevo el corte, la borro o la reasigno. El lote completo se
 * revierte.
 */
export const MSG_CARRERA_TRASPASO =
  "la orden cambio antes de completar el traspaso: actualiza la lista y vuelve a intentarlo";
