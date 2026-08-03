// Alternativa textual equivalente de una grafica (R10, R11, R31, R33).
//
// No es un truco de test: un SVG de barras es opaco para un lector de pantalla,
// asi que la unica forma honesta de que la grafica "diga" sus datos es esta
// lista. Que ademas sea lo unico afirmable en jsdom —donde no hay layout y
// `ResponsiveContainer` renderiza vacio— es una consecuencia afortunada, no el
// motivo (design.md §6.2).
//
// No importa `recharts` y no debe importarlo nunca: se renderiza SIEMPRE, tambien
// mientras el chunk diferido del lienzo viaja por la red.

import { formatearValor } from "./formato";
import type { MetricaUnidad, SerieDato } from "./tipos";
import type { SeriesPreparadas } from "./topes";

export interface SerieTextualProps {
  /** Series YA pasadas por `prepararSeries`: aqui no se recorta nada otra vez. */
  readonly series: readonly SerieDato[];
  readonly unidad: MetricaUnidad;
  /** Nombre accesible de la lista; lo pone la grafica a partir de su titulo. */
  readonly etiqueta: string;
  readonly recorteSeries: SeriesPreparadas["recorteSeries"];
  readonly recortePuntos: SeriesPreparadas["recortePuntos"];
  /**
   * Redacta el aviso de recorte. Lo pone el llamador para no incrustar texto de
   * UI en el paquete; sin el, el recorte se anuncia con los dos numeros crudos,
   * que es peor que un texto pero mucho mejor que el silencio (design.md §9.16).
   */
  readonly avisoRecorte?: (mostradas: number, recibidas: number) => string;
}

function redactar(
  aviso: SerieTextualProps["avisoRecorte"],
  mostradas: number,
  recibidas: number,
): string {
  return aviso ? aviso(mostradas, recibidas) : `${mostradas} / ${recibidas}`;
}

/**
 * Una entrada por punto de dato: serie, categoria y valor YA formateado.
 *
 * Va en `sr-only`: la informacion ya esta a la vista en el lienzo, y duplicarla
 * visualmente convertiria cada panel en una tabla. Sigue en el DOM aunque el
 * lienzo mida 0x0, que es lo que R10 exige.
 */
export function SerieTextual({
  series,
  unidad,
  etiqueta,
  recorteSeries,
  recortePuntos,
  avisoRecorte,
}: SerieTextualProps) {
  return (
    <div className="sr-only">
      {recorteSeries.recortado ? (
        <p>{redactar(avisoRecorte, recorteSeries.mostrados, recorteSeries.recibidos)}</p>
      ) : null}
      {recortePuntos.recortado ? (
        <p>{redactar(avisoRecorte, recortePuntos.mostrados, recortePuntos.recibidos)}</p>
      ) : null}
      <ul aria-label={etiqueta}>
        {series.flatMap((serie) =>
          serie.puntos.map((punto) => (
            <li key={`${serie.id}-${punto.categoria}`}>
              {`${serie.etiqueta}, ${punto.categoria}: ${formatearValor(punto.valor, unidad)}`}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}
