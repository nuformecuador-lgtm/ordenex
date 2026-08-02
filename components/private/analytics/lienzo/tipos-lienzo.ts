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
