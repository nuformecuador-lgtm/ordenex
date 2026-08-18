"use client";

// Grafica de donut. Igual que las otras dos en estados, titulo y alternativa textual, con UNA
// diferencia deliberada: aqui el color distingue SEGMENTOS, no series.
//
// ⚠ EL TECHO DE SEGMENTOS SE RETIRO (2026-08-18, decision humana). Aqui se aplicaba
// `MAX_SERIES` (5): un donut con seis categorias lanzaba fuera de produccion y en produccion
// pintaba cinco anunciandolo. El motivo era que la paleta tenia cinco tokens y no ciclaba.
// Ahora `paleta.ts` declara VEINTE y cicla, asi que se pintan TODAS las porciones — que es lo
// que un desglose por estado necesita, porque `ORDER_STATUS_SEED` tiene exactamente veinte
// valores y con el techo perdia quince.
//
// Lo que NO se aplica aqui, y sigue siendo deliberado: `MAX_PUNTOS_SERIE` (62). Es un techo
// de legibilidad de un eje TEMPORAL; en un donut daria 62 porciones, que no es un grafico.
// Agrupar la cola en "otros" sigue siendo decision de cada tablero (R34), no de este archivo.

import { Suspense, lazy } from "react";

import { formatearValor } from "./formato";
import { clasesDeLienzo, GraficaMarco } from "./GraficaMarco";
import { SerieTextual } from "./SerieTextual";
import type { AnilloProps, GraficaProps, SerieDato } from "./tipos";

/**
 * El donut, mas los tres ajustes del ANILLO (`innerRadius`, `outerRadius`, `centro`).
 * Los tres son opcionales y sus defaults son los de siempre: una llamada existente
 * dibuja exactamente lo que dibujaba.
 */
export type GraficaDonutProps = GraficaProps & AnilloProps;

const DonutLienzo = lazy(() => import("./lienzo/DonutLienzo"));

/**
 * Un donut pinta UNA serie: si llegan varias, se pinta la primera.
 *
 * Ya no recorta: todos los segmentos pasan. `recorteSegmentos` se conserva —siempre
 * `recortado: false`— porque lo lee `SerieTextual` para decidir si anuncia un aviso, y
 * quitarlo era tocar el contrato de la alternativa textual para no ganar nada.
 */
function prepararSegmentos(series: readonly SerieDato[]) {
  const serie = series[0];
  if (!serie) return null;
  const puntos = serie.puntos;
  return {
    series: [serie] as readonly SerieDato[],
    recorteSegmentos: {
      recortado: false,
      mostrados: puntos.length,
      recibidos: puntos.length,
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
  proporcion,
  innerRadius,
  outerRadius,
  centro,
  leyenda,
  mostrarValores,
}: GraficaDonutProps) {
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
      proporcion={proporcion}
    >
      {preparadas ? (
        <>
          <div className={clasesDeLienzo(proporcion)}>
            <Suspense fallback={null}>
              <DonutLienzo
                series={preparadas.series}
                formatear={(valor) => formatearValor(valor, unidad)}
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                centro={centro}
                leyenda={leyenda}
                mostrarValores={mostrarValores}
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
