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

/** Numero maximo de series visibles. Igual al numero de tokens `--chart-N` (R30, I4). */
export const MAX_SERIES = 5;

/**
 * Numero maximo de puntos por serie (R32).
 *
 * 62 = 53 semanas (el peor caso legitimo ya agregado en un rango de 366 dias) mas
 * margen, y a la vez 31 x 2: el rango DIARIO mas largo que sigue siendo legible en
 * los ~360 px de un movil (~5,8 px por punto). Esta a 6x de 366, asi que pasar el
 * rango anual crudo falla siempre y de forma inequivoca.
 */
export const MAX_PUNTOS_SERIE = 62;

/** Se superaron las series que el paquete sabe colorear sin repetir color (R31). */
export class SeriesExcedidasError extends Error {
  readonly recibidas: number;
  readonly tope: number;

  constructor(recibidas: number, tope: number = MAX_SERIES) {
    super(`Se recibieron ${recibidas} series y el tope del paquete es ${tope}`);
    this.name = "SeriesExcedidasError";
    this.recibidas = recibidas;
    this.tope = tope;
  }
}

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
 * Aplica `MAX_SERIES` (R31). Conserva las PRIMERAS en el orden recibido: el
 * llamador ya decidio ese orden y respetarlo hace el recorte predecible.
 */
export function aplicarTopeSeries<T>(series: readonly T[]): Recorte<T> {
  if (series.length <= MAX_SERIES) return sinRecorte(series);
  if (!esProduccion()) throw new SeriesExcedidasError(series.length);
  return {
    items: series.slice(0, MAX_SERIES),
    recortado: true,
    mostrados: MAX_SERIES,
    recibidos: series.length,
  };
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
 * Aplica los dos techos a un juego de series (R31, R33). Es la unica puerta por
 * la que pasan los datos antes de llegar al lienzo o a la alternativa textual,
 * de modo que ninguno de los dos puede emitir mas de
 * `MAX_SERIES x MAX_PUNTOS_SERIE` entradas (R10 acotado).
 */
export function prepararSeries(series: readonly SerieDato[]): SeriesPreparadas {
  const recorteSeries = aplicarTopeSeries(series);
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
