// La EFECTIVIDAD DE ENTREGA y el pendiente «en proceso», derivados del desglose por status.
//
// Modulo PURO: recibe las filas que ya trajo el desglose («Detalle de las órdenes») y devuelve
// numeros. Sin React, sin SWR, sin acciones y sin reloj, que es lo que permite comprobar aqui
// —sin renderizar nada— la unica cosa que puede equivocarse: el reparto entre lo que ya tuvo
// desenlace y lo que todavia no.
//
// ⚠ POR QUE NO HAY UNA CONSULTA NUEVA PARA ESTO, y es la mitad del punto: estas cifras salen
// EXACTAMENTE de las mismas filas que pinta el desglose por status. Una segunda consulta —aunque
// preguntara lo mismo— podria resolverse con un corte distinto (basta una gestion registrada
// entre las dos) y dejar en la misma pantalla un «85 % de efectividad» que no cuadra con los
// segmentos de al lado. Compartiendo filas, los KPIs y el grafico no pueden discrepar.
//
// «EN PROCESO» ES EL MISMO CUBO «OTROS» DEL ANILLO, y tampoco por casualidad: se define como
// «todo lo que no es uno de los cinco desenlaces», leyendo `DESENLACES`, que es la misma lista
// que pliega el anillo (`plegarEnDesenlaces`). Escribir aqui una segunda lista de estados «en
// curso» —los de reparto, los de bodega, los de recoleccion...— seria una lista que se queda
// atras el dia que el catalogo gane un estado: ese estado desapareceria de este KPI en silencio
// mientras el anillo si lo contaria. Con la regla por NEGACION, un estado nuevo entra solo.
//
// (Y por eso este archivo no escribe NINGUN value del catalogo salvo `entregada`, que es el
// numerador y no se puede evitar nombrar: `censo-order-status-rename.guardia` vigila que aqui
// no queden nombres de estados que el catalogo ya retiro.)

import { DESENLACES } from "@/lib/types/conteo-entregas";

/** Los cinco desenlaces como conjunto, para clasificar en O(1). Derivado, nunca reescrito. */
const CON_DESENLACE: ReadonlySet<string> = new Set<string>(DESENLACES);

/** El status `value` del catalogo que cuenta como entrega lograda. Es uno de `DESENLACES`. */
const ENTREGADA = "entregada";

/**
 * El otro desenlace que cuenta como GESTION cumplida: el destinatario rechazo el paquete.
 *
 * ⚠ POR QUE UN RECHAZO CUENTA A FAVOR y una devolucion no: la efectividad de la gestion mide el
 * trabajo del mensajero, y en un rechazo el mensajero SI llego, SI encontro al destinatario y SI
 * resolvio la orden — lo que fallo fue la venta, que no es cosa suya. En una devolucion, una
 * reprogramacion o un incidente la orden se queda sin resolver o vuelve, y eso si es gestion
 * pendiente. Es una decision de negocio (2026-08-18), no una propiedad del catalogo.
 */
const RECHAZADA = "rechazada";

export interface EfectividadEntrega {
  /** Ordenes cuyo ultimo desenlace es `entregada`. */
  readonly entregadas: number;
  /** Ordenes que todavia NO tienen desenlace: el mismo cubo «otros» del anillo. */
  readonly enProceso: number;
  /** El universo del recorte: la suma de todos los buckets. */
  readonly total: number;
  /**
   * Entregadas / total, como FRACCION (0,85 = 85 %) — que es lo que espera
   * `formatearValor(_, "porcentaje")`.
   *
   * `null` cuando el universo esta VACIO, y no `0`: sin ordenas que entregar no hay efectividad
   * que medir, y un «0 %» ahi afirma que se fallaron todas las entregas. Es la diferencia entre
   * «no hubo» y «salio mal», y la pantalla las pinta distinto.
   */
  readonly efectividad: number | null;
  /**
   * (entregadas + rechazadas) / total, como FRACCION. La EFECTIVIDAD DE LA GESTION.
   *
   * Se diferencia de `efectividad` solo en el numerador —suma los rechazos— y comparte el
   * denominador: el total de ordenes CREADAS del recorte. Por eso las dos son comparables entre
   * si y su diferencia es exactamente el peso de los rechazos.
   *
   * `null` con el universo vacio, por el mismo motivo que su hermana: sin ordenes que gestionar
   * no hay efectividad que medir, y un «0 %» afirmaria que se fallo cada gestion.
   */
  readonly efectividadGestion: number | null;
}

/**
 * Reparte el desglose por status en las cuatro cifras de arriba.
 *
 * OJO AL DENOMINADOR, que es la decision de esta funcion: la efectividad se mide sobre el
 * universo ENTERO del recorte, incluidas las ordenes que todavia estan en proceso. No sobre
 * «las ya cerradas». Las dos lecturas son defendibles y dan numeros muy distintos —con media
 * operacion en reparto, la segunda infla la cifra— y se elige la primera porque es la que
 * responde a «de todo lo que entro, cuanto se entrego». Si algun dia se quiere la otra, es una
 * decision con su propio nombre y su propio rotulo, no un cambio de este divisor.
 */
export function calcularEfectividad(
  porStatus: readonly { readonly status: string; readonly conteo: number }[],
): EfectividadEntrega {
  let entregadas = 0;
  let rechazadas = 0;
  let enProceso = 0;
  let total = 0;

  for (const fila of porStatus) {
    total += fila.conteo;
    if (fila.status === ENTREGADA) entregadas += fila.conteo;
    if (fila.status === RECHAZADA) rechazadas += fila.conteo;
    // Por NEGACION: lo que no es ninguno de los cinco desenlaces sigue su curso.
    if (!CON_DESENLACE.has(fila.status)) enProceso += fila.conteo;
  }

  return {
    entregadas,
    enProceso,
    total,
    efectividad: total > 0 ? entregadas / total : null,
    // MISMO denominador que la anterior, a proposito: las dos se leen una al lado de la otra en
    // la misma fila, y con denominadores distintos su diferencia no significaria nada.
    efectividadGestion: total > 0 ? (entregadas + rechazadas) / total : null,
  };
}
