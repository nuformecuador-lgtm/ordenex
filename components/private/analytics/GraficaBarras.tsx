"use client";

// Grafica de barras: estados, titulo accesible, alternativa textual y montaje
// DIFERIDO del lienzo (R27).
//
// El `import()` perezoso es lo que saca `recharts` del First Load JS: el chunk
// del lienzo viaja aparte y solo lo pide esta pantalla. Efecto secundario
// BUSCADO: mientras ese chunk carga, el titulo, el estado y la alternativa
// textual ya estan en el DOM — la informacion llega antes que el dibujo.
//
// Este archivo NO importa recharts (R26): solo el modulo perezoso lo hace.

import { Suspense, lazy } from "react";

import { formatearValor } from "./formato";
import { clasesDeLienzo, GraficaMarco } from "./GraficaMarco";
import { SerieTextual } from "./SerieTextual";
import type { BarrasProps, GraficaProps } from "./tipos";
import { prepararSeries } from "./topes";

const BarrasLienzo = lazy(() => import("./lienzo/BarrasLienzo"));

export function GraficaBarras({
  titulo,
  series,
  unidad,
  vacio,
  avisoRecorte,
  cargando,
  error,
  className,
  proporcion,
  apilado,
  horizontal,
  grosorBarra,
}: GraficaProps & BarrasProps) {
  const hayDatos = series.some((serie) => serie.puntos.length > 0);

  // Los topes solo se aplican cuando hay algo que pintar: con error o cargando
  // no hay dato que recortar y lanzar ahi seria ruido sin informacion.
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
              <BarrasLienzo
                series={preparadas.series}
                formatear={(valor) => formatearValor(valor, unidad)}
                apilado={apilado}
                horizontal={horizontal}
                grosorBarra={grosorBarra}
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
