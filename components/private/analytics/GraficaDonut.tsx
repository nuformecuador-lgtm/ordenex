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
import { pesosDeReparto, textoDePeso } from "./porcentajes";
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
  mostrarPorcentaje,
}: GraficaDonutProps) {
  const hayDatos = series.some((serie) => serie.puntos.length > 0);
  const preparadas = hayDatos && !error && !cargando ? prepararSegmentos(series) : null;

  // El PESO de cada porcion, calculado UNA vez y aqui —no en el lienzo— porque lo dicen DOS
  // salidas: el dibujo (leyenda y texto sobre la porcion) y la alternativa textual, que no pasa
  // por el lienzo. Con dos cuentas, el numero que se ve y el que lee un lector de pantalla
  // podrian discrepar.
  //
  // `pesosDeReparto` reparte por resto mayor (suma 100 % exacto) y `textoDePeso` lo ESCRIBE: el
  // numero lo pone `formatearValor(_, "porcentaje")` —simbolo y locale son del formateador de la
  // casa, aqui no se escribe ni un `%`— y el caso pequeno lleva delante el «menor que».
  //
  // ⚠ POR QUE NO SE FORMATEA LA FRACCION A SECAS (feature 291). Una porcion que EXISTE pero cuyo
  // peso exacto no llega a un punto redondea a 0, y con la fraccion redondeada salia «0 %» pegado
  // a su propia cifra: un cero que niega el dato que tiene al lado. `textoDePeso` escribe ahi
  // «<1 %», y el cero de verdad sigue diciendo «0 %» — son dos hechos distintos.
  //
  // El `ancho` que tambien devuelve el reparto no se usa AQUI, y es correcto: el anillo lo pinta
  // recharts con el VALOR CRUDO de cada punto, asi que ninguna porcion desaparece por el
  // redondeo. En este grafico la 291 es solo la etiqueta (en `GraficaReparto` si era el dibujo).
  const pesos =
    mostrarPorcentaje && preparadas
      ? pesosDeReparto(preparadas.series[0]?.puntos.map((punto) => punto.valor) ?? []).map((peso) =>
          textoDePeso(peso, (fraccion) => formatearValor(fraccion, "porcentaje")),
        )
      : undefined;

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
                pesos={pesos}
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
            pesos={pesos}
          />
        </>
      ) : null}
    </GraficaMarco>
  );
}
