// Props comunes a los tres lienzos. No importa recharts: es solo la forma del
// contrato entre la grafica (que resuelve estados, titulo y texto) y el dibujo.

import type { SerieDato } from "../tipos";

export interface LienzoProps {
  /** Series YA recortadas por `prepararSeries`: el lienzo no vuelve a recortar. */
  readonly series: readonly SerieDato[];
  /**
   * Formateo por unidad, ya resuelto por la grafica con `formato.ts`. Se pasa
   * hecho para que el lienzo no conozca `MetricaUnidad` ni la configuracion de
   * moneda: dibuja, no interpreta.
   */
  readonly formatear: (valor: number | null) => string;
}

/**
 * Lo que el lienzo del donut necesita ADEMAS de lo comun: el PESO de cada porcion.
 *
 * Cadenas YA formateadas (`"50 %"`), una por segmento y en el MISMO orden, calculadas por la
 * grafica. Llegan hechas por dos motivos, y el segundo es el que manda:
 *
 *  1. el lienzo no conoce el locale ni `MetricaUnidad`, y un `${Math.round(f * 100)} %` aqui
 *     seria el literal de idioma que `formato.ts` existe para que nadie escriba;
 *  2. el MISMO reparto lo dice tambien la alternativa textual (`SerieTextual`), que no pasa
 *     por el lienzo. Calculandolo arriba, el numero que se ve y el que se lee en voz alta
 *     salen de una sola cuenta y no pueden discrepar.
 *
 * Ausente => el anillo no escribe porcentajes.
 */
export interface DonutLienzoProps {
  readonly pesos?: readonly string[];
}


// `AnilloProps` vive en `../tipos` y no aqui: `GraficaDonut` tiene que declararla en SUS
// props, y el guardia de confinamiento de recharts (R26/R27) prohibe que una grafica
// importe nada de `./lienzo/` —aunque sea solo un tipo, que se borra en compilacion—,
// porque un import estatico a esta carpeta mete el lienzo en el First Load.
export type { AnilloProps, BarrasProps } from "../tipos";
