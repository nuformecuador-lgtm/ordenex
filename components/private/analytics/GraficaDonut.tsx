"use client";

// Grafica de donut. Igual que las otras dos en estados, titulo y alternativa
// textual, con UNA diferencia deliberada en el techo:
//
// en un donut el color distingue SEGMENTOS, no series. Aplicarle `MAX_PUNTOS_SERIE`
// (62) daria un donut de 62 porciones con cinco colores repetidos, que es
// exactamente lo que Q3 descarto: dos porciones del mismo color se leen como la
// misma categoria. Asi que aqui el techo de los segmentos es `MAX_SERIES` (5), y
// agrupar la cola en "otros" sigue siendo del tablero (R34). Un donut con mas de
// cinco categorias lanza `SeriesExcedidasError` fuera de produccion y en
// produccion muestra cinco anunciandolo, igual que el resto del paquete.

import { Suspense, lazy } from "react";

import { formatearValor } from "./formato";
import { CLASES_LIENZO, GraficaMarco } from "./GraficaMarco";
import { SerieTextual } from "./SerieTextual";
import type { GraficaProps, SerieDato } from "./tipos";
import { aplicarTopeSeries } from "./topes";

const DonutLienzo = lazy(() => import("./lienzo/DonutLienzo"));

/** Un donut pinta UNA serie: si llegan varias, se pinta la primera. */
function prepararSegmentos(series: readonly SerieDato[]) {
  const serie = series[0];
  if (!serie) return null;
  const recorte = aplicarTopeSeries(serie.puntos);
  return {
    series: [{ ...serie, puntos: recorte.items }] as readonly SerieDato[],
    recorteSegmentos: {
      recortado: recorte.recortado,
      mostrados: recorte.mostrados,
      recibidos: recorte.recibidos,
    },
  };
}

export function GraficaDonut({
  titulo,
  series,
  unidad,
  vacio,
  avisoRecorte,
  cargando,
  error,
  className,
}: GraficaProps) {
  const hayDatos = series.some((serie) => serie.puntos.length > 0);
  const preparadas = hayDatos && !error && !cargando ? prepararSegmentos(series) : null;

  return (
    <GraficaMarco
      titulo={titulo}
      vacio={vacio}
      hayDatos={hayDatos}
      cargando={cargando}
      error={error}
      className={className}
    >
      {preparadas ? (
        <>
          <div className={CLASES_LIENZO}>
            <Suspense fallback={null}>
              <DonutLienzo
                series={preparadas.series}
                formatear={(valor) => formatearValor(valor, unidad)}
              />
            </Suspense>
          </div>
          <SerieTextual
            series={preparadas.series}
            unidad={unidad}
            etiqueta={titulo}
            recorteSeries={preparadas.recorteSegmentos}
            recortePuntos={{ recortado: false, mostrados: 0, recibidos: 0 }}
            avisoRecorte={avisoRecorte}
          />
        </>
      ) : null}
    </GraficaMarco>
  );
}
