"use client";

// Grafica de lineas. Misma estructura que `GraficaBarras`: estados + titulo
// accesible + alternativa textual + lienzo diferido (R27). No importa recharts.

import { Suspense, lazy } from "react";

import { formatearValor } from "./formato";
import { clasesDeLienzo, GraficaMarco } from "./GraficaMarco";
import { SerieTextual } from "./SerieTextual";
import type { GraficaProps } from "./tipos";
import { prepararSeries } from "./topes";

const LineasLienzo = lazy(() => import("./lienzo/LineasLienzo"));

export function GraficaLineas({
  titulo,
  series,
  unidad,
  vacio,
  avisoRecorte,
  cargando,
  error,
  className,
  proporcion,
}: GraficaProps) {
  const hayDatos = series.some((serie) => serie.puntos.length > 0);
  const preparadas = hayDatos && !error && !cargando ? prepararSeries(series) : null;

  return (
    <GraficaMarco
      titulo={titulo}
      vacio={vacio}
      hayDatos={hayDatos}
      cargando={cargando}
      error={error}
      className={className}
      proporcion={proporcion}
    >
      {preparadas ? (
        <>
          <div className={clasesDeLienzo(proporcion)}>
            <Suspense fallback={null}>
              <LineasLienzo
                series={preparadas.series}
                formatear={(valor) => formatearValor(valor, unidad)}
              />
            </Suspense>
          </div>
          <SerieTextual
            series={preparadas.series}
            unidad={unidad}
            etiqueta={titulo}
            recorteSeries={preparadas.recorteSeries}
            recortePuntos={preparadas.recortePuntos}
            avisoRecorte={avisoRecorte}
          />
        </>
      ) : null}
    </GraficaMarco>
  );
}
