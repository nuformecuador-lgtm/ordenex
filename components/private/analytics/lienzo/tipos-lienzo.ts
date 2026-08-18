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

// `AnilloProps` vive en `../tipos` y no aqui: `GraficaDonut` tiene que declararla en SUS
// props, y el guardia de confinamiento de recharts (R26/R27) prohibe que una grafica
// importe nada de `./lienzo/` —aunque sea solo un tipo, que se borra en compilacion—,
// porque un import estatico a esta carpeta mete el lienzo en el First Load.
export type { AnilloProps } from "../tipos";
