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
//
// ─── FICHA 346 — EL DESGLOSE SUMA, Y ANTES NO SUMABA ───────────────────────────────────────
//
// El defecto, medido en produccion el 2026-08-29 sobre `Crema Especial MLX`: 24 ordenes, y el
// desglose de la tabla de productos pintaba 3 entregadas + 2 rechazadas + 13 en proceso = 18.
// Faltaban SEIS ordenes que no aparecian en ninguna columna. No era un error de conteo: eran
// las ordenes con uno de los OTROS TRES desenlaces —los que no son `entregada` ni `rechazada`—,
// que no entraban en los dos cubos por igualdad y tampoco en `enProceso`, porque `enProceso` es
// «lo que NO tiene desenlace» y ellas si lo tienen. Se evaporaban entre las dos reglas.
//
// La reparacion es ADITIVA (misma forma que la ficha 345 con `rechazadas`): la funcion YA sabia
// cuales eran —lo sabe cualquiera que lea `CON_DESENLACE`— y las tiraba al volver. Ahora las
// EXPONE en `otrosDesenlaces`, y con eso los cuatro cubos parten el universo entero:
//
//     entregadas + rechazadas + otrosDesenlaces + enProceso === total   (SIEMPRE)
//
// No es una invariante que alguien tenga que recordar sumando a mano: cada fila del desglose cae
// en UNO y SOLO UNO de los cuatro cubos, asi que la igualdad se sostiene por construccion. La
// vigila `tests/unit/analytics/efectividad-suma.test.ts`, que ademas recorre `DESENLACES` de
// verdad: un desenlace nuevo del catalogo entra en el caso solo.
//
// ⚠ Y `otrosDesenlaces` SE DERIVA, no se escribe: es «esta en `DESENLACES` y no es ninguno de
// los dos que ya tienen cubo propio». Escribir aqui `["devuelta", "reprogramada", "incidente"]`
// seria exactamente la lista que prohibe el parrafo de arriba: el dia que el catalogo gane un
// sexto desenlace, ese estado volveria a evaporarse — el mismo defecto, otra vez y en silencio.
//
// Los TRES PORCENTAJES NO SE TOCAN (y esa es la otra mitad de la ficha): `efectividad`,
// `efectividadGestion` y `tasaRechazo` ya usaban el denominador correcto —el universo entero—,
// asi que el defecto nunca estuvo en ellos. 3/24 = 12,5 % era la cifra buena; lo que faltaba era
// la columna que explicara de donde salia el 24.

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

/**
 * FICHA 347 (F1) — los desenlaces que YA tienen columna propia en la tabla de productos.
 *
 * Se declara AQUI, junto a los dos literales, y se exporta: la composicion de «Otros
 * resultados» (`otros-resultados.ts`) necesita saber cuales excluir, y si escribiera su propia
 * pareja habria DOS reglas para la misma particion. Divergirian el dia que la tabla gane o
 * pierda una columna de desenlace, y el cubo dejaria de cuadrar con su composicion sin que
 * nada se pusiera rojo.
 *
 * NO es una lista de desenlaces: es la lista de los que tienen COLUMNA. Lo que se deriva de
 * `DESENLACES` es el resto, que es donde vive el defecto que la 346 reparo.
 */
export const DESENLACES_CON_COLUMNA_PROPIA: readonly string[] = [ENTREGADA, RECHAZADA];

export interface EfectividadEntrega {
  /** Ordenes cuyo ultimo desenlace es `entregada`. */
  readonly entregadas: number;
  /**
   * Ordenes cuyo ultimo desenlace es `rechazada`: el destinatario dijo que no.
   *
   * FICHA 345 (T6.1) — ESTE CAMPO NO ES UNA CIFRA NUEVA: la funcion YA lo contaba (era el
   * sumando que separa `efectividadGestion` de `efectividad`) y lo tiraba al volver. Aqui
   * solo se EXPONE. El motivo de exponerlo en vez de recontarlo en la pantalla de productos
   * es el de siempre en este archivo: una segunda cuenta de rechazos, con su propia idea de
   * que es un rechazo, acabaria discrepando de la fila de KPIs de dos secciones mas arriba.
   */
  readonly rechazadas: number;
  /**
   * FICHA 346 — Ordenes con un desenlace que NO es `entregada` ni `rechazada`.
   *
   * ES EL CUBO QUE FALTABA, y sin el las cifras de la pantalla no sumaban: estas ordenes no
   * eran ninguno de los dos desenlaces con cubo propio y tampoco eran `enProceso` —que se
   * define como «sin desenlace» y ellas SI lo tienen—, asi que desaparecian de la lectura.
   *
   * SE DERIVA DE `DESENLACES`, nunca de una lista escrita aqui: es «tiene desenlace y no es
   * uno de los dos que ya se cuentan aparte». Por eso un desenlace nuevo del catalogo cae aqui
   * solo, en vez de evaporarse — que es el defecto que esta ficha repara.
   *
   * NO es «lo que salio mal»: mezcla una devolucion con una reprogramacion, que son cosas
   * distintas. Es el RESTO del desglose, y su unico compromiso es que el reparto cuadre. Quien
   * necesite el detalle de cada desenlace lo tiene en el anillo «Detalle gestión» de la misma
   * pantalla, que los pinta por separado.
   */
  readonly otrosDesenlaces: number;
  /** Ordenes que todavia NO tienen desenlace: el mismo cubo «otros» del anillo. */
  readonly enProceso: number;
  /**
   * El universo del recorte: la suma de todos los buckets.
   *
   * FICHA 346 — y «todos» son CUATRO desde esta ficha:
   * `entregadas + rechazadas + otrosDesenlaces + enProceso === total`, siempre y por
   * construccion, porque cada fila del desglose cae en uno y solo uno.
   */
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
  /**
   * FICHA 345 (T6.1) — `rechazadas / total`, como FRACCION (0,375 = 37,5 %).
   *
   * MISMO DENOMINADOR que sus dos hermanas de arriba, y no «sobre las ya cerradas»: las tres
   * se leen en la misma fila y con denominadores distintos su comparacion no significaria
   * nada. El precio, dicho: con media operacion en reparto esta tasa sale mas baja de lo que
   * acabara siendo, exactamente igual que la efectividad sale mas baja.
   *
   * `null` con el universo VACIO —no `0`— por el mismo motivo que sus hermanas: sin ordenes
   * no hay tasa que medir, y un «0 %» ahi afirma que no rechazaron ninguna. Ojo a la
   * diferencia que esto conserva, que es la unica razon de que el tipo sea `number | null`:
   * `0` es «29 ordenes y ni un rechazo» (el caso medido de `Balsamo Tensor`) y `null` es «no
   * hubo ordenes». Son dos hechos distintos y la pantalla los pinta distinto.
   */
  readonly tasaRechazo: number | null;
}

/**
 * Reparte el desglose por status en las cifras de arriba.
 *
 * EL REPARTO ES UNA PARTICION (ficha 346): las cuatro condiciones del bucle de abajo se excluyen
 * entre si y lo cubren todo, asi que cada orden cae en UN cubo y ninguna se queda fuera. De ahi
 * sale la igualdad `entregadas + rechazadas + otrosDesenlaces + enProceso === total`, que la
 * pantalla necesita para que su desglose cuadre con la columna «Órdenes».
 *
 * Las cuatro reglas se escriben SUELTAS y no como una cadena `else if`, para que cada una siga
 * leyendose con su motivo al lado — sobre todo la de `enProceso`, que es la regla por NEGACION
 * que explica la cabecera. Lo que sostiene la particion es que `ENTREGADA` y `RECHAZADA` son
 * dos de los `DESENLACES`: si alguna vez dejaran de serlo, la igualdad se rompe. No se confia en
 * que alguien lo recuerde — lo mide `tests/unit/analytics/efectividad-suma.test.ts` sobre las
 * 16.384 combinaciones de conteos que se pueden armar con el catalogo de verdad.
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
  let otrosDesenlaces = 0;
  let enProceso = 0;
  let total = 0;

  for (const fila of porStatus) {
    total += fila.conteo;
    if (fila.status === ENTREGADA) entregadas += fila.conteo;
    if (fila.status === RECHAZADA) rechazadas += fila.conteo;
    // FICHA 346 — el RESTO de los desenlaces: lo que YA se resolvio y no es ninguno de los dos
    // que tienen cubo propio. Es el cubo que faltaba, y por eso el desglose no sumaba.
    //
    // ⚠ SE DERIVA DE `DESENLACES` («esta en la lista y no es uno de los dos de arriba») y no se
    // escribe: una lista literal aqui dejaria fuera al sexto desenlace que el catalogo gane, y
    // ese estado se evaporaria en silencio — que es EXACTAMENTE el defecto que esta ficha
    // repara, repetido. Las cuatro reglas se leen sueltas a proposito, cada una con su motivo;
    // que formen una particion —y por tanto que los cuatro cubos sumen `total`— lo comprueba
    // `tests/unit/analytics/efectividad-suma.test.ts` recorriendo `DESENLACES` de verdad.
    if (CON_DESENLACE.has(fila.status) && fila.status !== ENTREGADA && fila.status !== RECHAZADA)
      otrosDesenlaces += fila.conteo;
    // Por NEGACION: lo que no es ninguno de los cinco desenlaces sigue su curso.
    if (!CON_DESENLACE.has(fila.status)) enProceso += fila.conteo;
  }

  return {
    entregadas,
    rechazadas,
    otrosDesenlaces,
    enProceso,
    total,
    efectividad: total > 0 ? entregadas / total : null,
    // MISMO denominador que la anterior, a proposito: las dos se leen una al lado de la otra en
    // la misma fila, y con denominadores distintos su diferencia no significaria nada.
    efectividadGestion: total > 0 ? (entregadas + rechazadas) / total : null,
    // Y el mismo denominador otra vez (ficha 345): es el UNIVERSO del recorte, no las cerradas.
    tasaRechazo: total > 0 ? rechazadas / total : null,
  };
}
