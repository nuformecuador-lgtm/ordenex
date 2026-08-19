// Techos del paquete y politica de desbordamiento (R30-R33, decisiones Q3 y Q6).
//
// Modulo PURO: sin React, sin DOM. Se prueba alternando `NODE_ENV`, que es justo
// lo que exigen R31 y R33.
//
// Politica, identica para series y para puntos (design.md §3.3):
//   - fuera de produccion  -> LANZA un error con nombre propio. El llamador es un
//     tablero nuestro (131): su bug tiene que morir en SU test, no viajar a
//     produccion. Un `console.warn` no rompe ninguna build y se ignora.
//   - en produccion        -> RECORTA y devuelve el dato para anunciarlo con texto.
//     Tirar la pantalla entera de /analitica porque una metrica crecio de 5 a 6
//     categorias seria peor que el fallo que se intenta evitar; y recortar EN
//     SILENCIO seria peor todavia (un grafico plausible pero falso).
//
// Lo que este modulo NO hace, y no es un olvido (R34): no agrupa la cola en
// "otros" ni re-muestrea por semana o mes. Los dos calculos son del tablero 131,
// que es quien conoce fechas, zona horaria y `RangoResuelto`.

import type { SerieDato } from "./tipos";

// ⚠ AQUI VIVIA `MAX_SERIES = 5`, el techo de categorias del paquete, y se RETIRO el
// 2026-08-18 por decision humana. Existia por una sola razon: la paleta tenia cinco tokens y
// no ciclaba, asi que la sexta categoria se habria pintado del color de otra. Ahora
// `paleta.ts` declara VEINTE y cicla, de modo que ya no hay nada que recortar — y recortar
// costaba dato: un desglose de ordenes por estado perdia quince buckets de veinte.
//
// El techo de PUNTOS (`MAX_PUNTOS_SERIE`) NO se toca y sigue vivo: aquel no es de color, es
// de legibilidad de un eje temporal, y ninguna paleta lo resuelve.

/**
 * Cuantas categorias sigue mostrando un tablero antes de fundir la cola en «otros».
 *
 * ⚠ NO ES EL VIEJO `MAX_SERIES`, aunque valga lo mismo. Aquel era un techo de COLOR —el
 * paquete no sabia pintar mas de cinco— y el paquete lo aplicaba por su cuenta, recortando el
 * dato. Este es de LEGIBILIDAD y lo aplica cada TABLERO sobre sus propios datos: nadie quiere
 * un donut financiero de quince porciones aunque ahora todas tuvieran color propio.
 *
 * La diferencia que importa: el paquete ya no recorta nada. Un tablero que NO agrupe muestra
 * todas sus categorias, y eso es una decision suya — es justo lo que hace el desglose de
 * ordenes por estado, que quiere sus veinte buckets enteros.
 *
 * Lo consumen `_components/operativo/agregacion.ts` y `_components/financiero`.
 */
export const MAX_CATEGORIAS_LEGIBLES = 5;

/**
 * Numero maximo de puntos por serie (R32).
 *
 * 62 = 53 semanas (el peor caso legitimo ya agregado en un rango de 366 dias) mas
 * margen, y a la vez 31 x 2: el rango DIARIO mas largo que sigue siendo legible en
 * los ~360 px de un movil (~5,8 px por punto). Esta a 6x de 366, asi que pasar el
 * rango anual crudo falla siempre y de forma inequivoca.
 */
export const MAX_PUNTOS_SERIE = 62;

/** Se superaron los puntos por serie que el paquete acepta pintar (R33). */
export class PuntosExcedidosError extends Error {
  readonly recibidos: number;
  readonly tope: number;

  constructor(recibidos: number, tope: number = MAX_PUNTOS_SERIE) {
    super(`Se recibieron ${recibidos} puntos en una serie y el tope del paquete es ${tope}`);
    this.name = "PuntosExcedidosError";
    this.recibidos = recibidos;
    this.tope = tope;
  }
}

/** Resultado de aplicar un techo: que queda, y con que numeros anunciarlo. */
export interface Recorte<T> {
  readonly items: readonly T[];
  readonly recortado: boolean;
  readonly mostrados: number;
  readonly recibidos: number;
}

function esProduccion(): boolean {
  return process.env.NODE_ENV === "production";
}

function sinRecorte<T>(items: readonly T[]): Recorte<T> {
  return { items, recortado: false, mostrados: items.length, recibidos: items.length };
}

/**
 * Aplica `MAX_PUNTOS_SERIE` (R33). Conserva los ULTIMOS puntos, no los primeros:
 * en una serie temporal lo reciente es lo que se esta mirando, y quedarse con
 * enero cuando el usuario pidio el ano seria absurdo.
 */
export function aplicarTopePuntos<T>(puntos: readonly T[]): Recorte<T> {
  if (puntos.length <= MAX_PUNTOS_SERIE) return sinRecorte(puntos);
  if (!esProduccion()) throw new PuntosExcedidosError(puntos.length);
  return {
    items: puntos.slice(puntos.length - MAX_PUNTOS_SERIE),
    recortado: true,
    mostrados: MAX_PUNTOS_SERIE,
    recibidos: puntos.length,
  };
}

/** Series ya recortadas, con lo necesario para anunciar cada recorte por texto. */
export interface SeriesPreparadas {
  readonly series: readonly SerieDato[];
  readonly recorteSeries: Omit<Recorte<never>, "items">;
  /** Del peor caso entre las series: el aviso habla del maximo recortado. */
  readonly recortePuntos: Omit<Recorte<never>, "items">;
}

/**
 * Aplica el techo de PUNTOS a un juego de series (R33). Es la unica puerta por la que pasan
 * los datos antes de llegar al lienzo o a la alternativa textual.
 *
 * ⚠ YA NO RECORTA SERIES (2026-08-18). Antes aplicaba tambien `MAX_SERIES`, el techo de
 * categorias, porque la paleta solo sabia colorear cinco. Ahora `paleta.ts` tiene veinte
 * tokens y cicla, asi que TODAS las categorias llegan al lienzo.
 *
 * `recorteSeries` se CONSERVA en la salida —siempre `recortado: false`— y no se borra: lo
 * leen `SerieTextual` y las tres graficas para decidir si anuncian un aviso. Quitarlo era
 * tocar cinco componentes para no ganar nada; dejarlo dice, con sus propios numeros, que no
 * se recorto nada. Si algun dia no queda ningun consumidor, se retira entero.
 */
export function prepararSeries(series: readonly SerieDato[]): SeriesPreparadas {
  // Sin techo de categorias: entran todas. `sinRecorte` deja el aviso en `false` con los
  // numeros reales, que es lo que los consumidores esperan leer.
  const recorteSeries = sinRecorte(series);
  let puntosRecortados = false;
  let puntosMostrados = 0;
  let puntosRecibidos = 0;

  const preparadas = recorteSeries.items.map((serie) => {
    const recorte = aplicarTopePuntos(serie.puntos);
    puntosRecortados = puntosRecortados || recorte.recortado;
    puntosMostrados = Math.max(puntosMostrados, recorte.mostrados);
    puntosRecibidos = Math.max(puntosRecibidos, recorte.recibidos);
    return { ...serie, puntos: recorte.items };
  });

  return {
    series: preparadas,
    recorteSeries: {
      recortado: recorteSeries.recortado,
      mostrados: recorteSeries.mostrados,
      recibidos: recorteSeries.recibidos,
    },
    recortePuntos: {
      recortado: puntosRecortados,
      mostrados: puntosMostrados,
      recibidos: puntosRecibidos,
    },
  };
}
