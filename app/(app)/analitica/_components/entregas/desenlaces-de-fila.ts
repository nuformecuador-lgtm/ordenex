// FICHA 442 (F1) — EN QUE TERMINARON las ordenes de UNA fila de la tabla de productos.
//
// El defecto que esto repara, medido a 1440 px el 2026-09-17 con sesion de maestro: la tabla
// tenia 14 columnas, de las cuales CUATRO eran los cubos del desglose (entregadas, rechazadas,
// otros resultados, en proceso) y solo 7 columnas cabian sin desplazar. Cuatro columnas de
// numeros para responder una pregunta —«¿como acabaron?»— que se lee mejor de un vistazo.
//
// Aqui esas cuatro cifras se convierten en DOS piezas: los tramos de una barra y una frase que
// los enumera. Ninguna cifra se pierde; cambian de forma, no de valor.
//
// ─── NO SE CALCULA NINGUNA EFECTIVIDAD NUEVA (R28 de la 345, y el pedido de la 442) ─────────
//
// Todo sale de `calcularEfectividad`, que es la MISMA funcion que alimenta la tarjeta heroe de
// la ficha 441, la fila de KPIs y el archivo descargable. Este modulo no cuenta: reparte lo que
// aquella ya conto. Un segundo reparto —aunque diera el mismo numero hoy— seria una segunda
// definicion de «entregada» a dos secciones de distancia.
//
// ─── LOS TRES TRAMOS SON LOS DEL HEROE, Y NO POR CASUALIDAD ─────────────────────────────────
//
// `EfectividadHeroe` (ficha 441) parte su barra en `entregadas` / `otroDesenlace` / `vivas`. La
// barra de esta tabla usa EXACTAMENTE la misma particion y los mismos colores, de modo que la
// fila de un producto se lee con el mismo vocabulario visual que el numero grande de arriba.
// Con dos particiones distintas en la misma pantalla, el naranja significaria una cosa arriba y
// otra abajo.
//
// `otroDesenlace` = `rechazadas + otrosDesenlaces`. Se DERIVA de los cubos de
// `calcularEfectividad`, no se recuenta leyendo status: el dia que el catalogo gane un sexto
// desenlace entra solo, que es la leccion de la ficha 346.
//
// Modulo PURO: sin React, sin DOM, sin SWR y sin colores. Los colores viven en el `.tsx` porque
// son presentacion; el REPARTO vive aqui porque es dato.

import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

import { calcularEfectividad } from "./efectividad";
import { etiquetaDeDesenlace } from "./etiqueta-desenlace";
import { composicionOtrosResultados, SEPARADOR_COMPOSICION } from "./otros-resultados";

/** Los tres tramos de la barra, en el orden en que se pintan. */
export type IdTramoDesenlace = "entregadas" | "otroDesenlace" | "enProceso";

export interface TramosDeFila {
  /** Ordenes entregadas: el numerador de la efectividad. */
  readonly entregadas: number;
  /** Ordenes YA resueltas que no son una entrega: rechazos y el resto de los desenlaces. */
  readonly otroDesenlace: number;
  /** Ordenes todavia sin desenlace. Es el mismo cubo «vivas» del heroe. */
  readonly enProceso: number;
  /** El universo de la fila: los tres de arriba, que por construccion son una particion. */
  readonly total: number;
}

/**
 * El reparto de UNA fila en los tres tramos.
 *
 * ⚠ LA SUMA DE LOS TRES ES `total` SIEMPRE, y no porque alguien lo recuerde: los cuatro cubos de
 * `calcularEfectividad` ya son una particion (ficha 346, con sus 16.384 combinaciones probadas)
 * y aqui solo se funden dos de ellos. Esa igualdad es lo que deja pintar la barra sin ajustar el
 * ultimo segmento a ojo.
 */
export function tramosDeFila(porStatus: readonly ConteoDeStatus[]): TramosDeFila {
  const e = calcularEfectividad(porStatus);
  return {
    entregadas: e.entregadas,
    otroDesenlace: e.rechazadas + e.otrosDesenlaces,
    enProceso: e.enProceso,
    total: e.total,
  };
}

/** Un trozo de la frase: cuantas ordenes y como se llaman. */
export interface ParteDesenlace {
  /** Identificador estable del trozo. Los del catalogo llevan su `value`. */
  readonly clave: string;
  /** Como se nombra: el nombre visible EXACTO del desenlace (FICHA 455, R2), o el rotulo del grupo. */
  readonly etiqueta: string;
  readonly conteo: number;
}

/**
 * El ROTULO de las ordenes que siguen su curso. No es un `value` del catalogo —se define por
 * NEGACION, es «lo que no tiene desenlace»— asi que es el unico nombre escrito a mano de este
 * modulo, y se escribe UNA vez.
 *
 * FICHA 455 (2026-09-24, R6): antes decia «en proceso», un nombre retirado (§0.3: era el hito del
 * rastreo para los estados fuera de catalogo). Es un GRUPO, asi que lleva un texto propio que no es
 * el nombre de ningun estado. Lo comparten la tarjeta de `KpisEfectividad` y la columna del archivo.
 */
export const ETIQUETA_EN_PROCESO = "Sin desenlace todavía";

/**
 * EN QUE TERMINARON las ordenes de la fila, trozo a trozo y en orden de lectura:
 * entregadas, rechazadas, el resto de los desenlaces y lo que sigue en proceso.
 *
 * Los cubos en CERO no se nombran: «0 rechazadas» no es informacion en una frase de una linea,
 * es ruido — y la barra tampoco pinta un segmento de ancho cero (misma regla que la 258).
 *
 * ⚠ LAS ETIQUETAS SALEN DE `etiquetaDeDesenlace`, el mecanismo vivo, y NO de una tabla escrita
 * aqui: `order_status` no tiene columna `label` y una tabla propia se desincronizaria en el
 * proximo renombre del catalogo. El resto de los desenlaces sale de `composicionOtrosResultados`,
 * que ya es la regla derivada que usan la celda de «Otros resultados» y el archivo descargable.
 *
 * ⚠ FICHA 455 (2026-09-24, R2): cada desenlace por su nombre visible EXACTO (`nombreDeEstado`):
 * sin plural, sin minusculas. Antes la frase decia «4 entregadas · 1 rechazada» pluralizando el
 * codigo. La MISMA etiqueta la usa `textoComposicionOtrosResultados`, que viaja al archivo
 * descargable, asi que la pantalla y el `.xlsx` que se abre al lado no dicen la fila de dos formas.
 */
export function partesDesenlaceDeFila(
  porStatus: readonly ConteoDeStatus[],
): readonly ParteDesenlace[] {
  const e = calcularEfectividad(porStatus);
  const partes: ParteDesenlace[] = [
    {
      clave: "entregado",
      etiqueta: etiquetaDeDesenlace("entregado"),
      conteo: e.entregadas,
    },
    {
      clave: "devolucion_a_origen_por_rechazo",
      etiqueta: etiquetaDeDesenlace("devolucion_a_origen_por_rechazo"),
      conteo: e.rechazadas,
    },
    // El RESTO de los desenlaces, cada uno por su nombre y en el orden determinista que ya fija
    // `composicionOtrosResultados` (cantidad desc, `status` asc por unidades de codigo).
    ...composicionOtrosResultados(porStatus).map<ParteDesenlace>((trozo) => ({
      clave: trozo.status,
      etiqueta: etiquetaDeDesenlace(trozo.status),
      conteo: trozo.conteo,
    })),
    { clave: "en_proceso", etiqueta: ETIQUETA_EN_PROCESO, conteo: e.enProceso },
  ];
  return partes.filter((parte) => parte.conteo > 0);
}

/**
 * La frase: «Entregado: 4 · Devolución a origen por rechazo: 1 · Sin desenlace todavía: 1».
 * FICHA 455 (R2): el nombre va entero y la cantidad a su lado, tras dos puntos.
 *
 * ⚠ ESTA FRASE ES EL DATO ACCESIBLE DE LA BARRA. La barra es `aria-hidden` —pintura— y esta
 * linea es la que lee cualquier tecnologia de apoyo, exactamente el mismo reparto de papeles que
 * la barra del heroe de la 441. Por eso enumera TODOS los cubos con conteo y no un resumen.
 *
 * ⚠ EL NUMERO SE INTERPOLA CRUDO, sin `Intl`, por lo mismo que `textoComposicionOtrosResultados`:
 * la frase tiene que ser la misma en cualquier maquina.
 *
 * Cadena VACIA sin ninguna orden: la fila no tiene nada que contar y una frase en blanco es una
 * linea que hace la fila mas alta sin decir nada.
 */
export function textoDesenlacesDeFila(porStatus: readonly ConteoDeStatus[]): string {
  return partesDesenlaceDeFila(porStatus)
    .map((parte) => `${parte.etiqueta}: ${parte.conteo}`)
    .join(SEPARADOR_COMPOSICION);
}
