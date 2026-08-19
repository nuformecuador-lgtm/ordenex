"use client";

// RANKING: una fila por categoría, con su barra, su cifra y su peso.
//
// Recibe UNA serie con N puntos y los pinta EN EL ORDEN EN QUE LLEGAN — quien los ordena es
// quien los trae (los repositorios de esta vertical ya devuelven de mayor a menor). Reordenar
// aquí sería una segunda opinión sobre el orden, y el color se asigna por posición: dos
// criterios distintos repintarían los mismos datos de otro color según quién tocara al final.
//
// ─── POR QUÉ ESTO Y NO UNA DONA (decisión del 2026-08-18) ───────────────────────────────
//
// El desglose por estado trae hasta veinte categorías. Una dona de veinte porciones no es un
// gráfico: las pequeñas se vuelven líneas, los colores se confunden a ojo y para saber cuál
// manda hay que comparar ángulos. En filas ordenadas la respuesta se lee en el primer vistazo
// y la vigésima categoría conserva su nombre escrito al lado.
//
// AQUÍ NO SE RECORTA NI SE AGRUPA NADA: salen todas las categorías que llegan. Meter la cola en
// un cubo «otros» haría desaparecer estados reales; y el alto de una lista de filas crece solo,
// que es justo la ventaja sobre un lienzo de alto fijo, donde veinte etiquetas no caben y
// recharts se salta la mitad sin avisar.
//
// ─── DOS ESCALAS, Y CADA UNA RESPONDE OTRA COSA ─────────────────────────────────────────
//
// El ANCHO de la barra es relativo al MAYOR —el primero llena la fila—, que es la comparación
// que un ranking viene a hacer. El PORCENTAJE escrito es sobre el TOTAL, que es cuánto pesa esa
// categoría en el conjunto. Si el ancho fuera sobre el total, con veinte categorías todas las
// barras serían astillas indistinguibles.
//
// Sin recharts, por lo mismo que `GraficaReparto`. El marco, los estados y la alternativa
// textual se reusan del paquete.

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { formatearValor } from "./formato";
import { GraficaMarco } from "./GraficaMarco";
import { cifraConPeso, porcentajesDeReparto } from "./porcentajes";
import { SerieTextual } from "./SerieTextual";
import type { GraficaProps } from "./tipos";

/** Alto de cada barra, en px. Con veinte filas, más grueso convierte la tarjeta en una columna. */
const ALTO_BARRA = 14;

/**
 * Retardo entre una barra y la siguiente, en ms. La entrada se escalona de arriba abajo: se lee
 * como una lista que se rellena por orden, que es justo lo que un ranking es. Corto a propósito
 * — con veinte filas, 40 ms ya suman 800 ms hasta la última.
 */
const ESCALON_MS = 40;

export function GraficaRanking({
  titulo,
  series,
  unidad,
  vacio,
  cargando,
  error,
  className,
  proporcion,
}: GraficaProps) {
  const serie = series[0];
  const puntos = serie?.puntos ?? [];
  const hayDatos = puntos.length > 0;

  // El mayor manda la escala del ancho. El `|| 1` cubre el caso de que todo valga cero: las
  // barras miden 0 y las cifras siguen diciendo la verdad, en vez de dividir entre cero.
  const mayor = puntos.reduce((max, punto) => Math.max(max, punto.valor ?? 0), 0) || 1;
  const pesos = porcentajesDeReparto(puntos.map((punto) => punto.valor)).map((fraccion) =>
    formatearValor(fraccion, "porcentaje"),
  );

  return (
    <GraficaMarco
      titulo={titulo}
      vacio={vacio}
      hayDatos={hayDatos}
      cargando={cargando}
      error={error}
      className={className}
      // Se reenvia aunque aqui no haya lienzo: `GraficaMarco` la usa para el ESQUELETO de
      // carga, y sin ella el hueco que se ve mientras llega el dato tendria otra proporcion
      // que el grafico que va a ocuparlo — la fila daria un salto al resolverse.
      proporcion={proporcion}
    >
      {hayDatos && serie ? (
        <>
          {/* `aria-hidden`: la misma información, mejor dicha, está en la lista de abajo. */}
          <ul aria-hidden="true" className="flex w-full flex-col gap-2">
            {puntos.map((punto, indice) => (
              <li
                key={punto.categoria}
                // Tres columnas: nombre, barra elástica y cifra a la derecha. `minmax(0, 1fr)`
                // en la del medio para que la barra se encoja en vez de desbordar la fila
                // cuando el nombre es largo; `tabular-nums` para que las cifras alineen.
                className="grid items-center gap-3 text-sm"
                style={{ gridTemplateColumns: "minmax(88px, 136px) minmax(0, 1fr) auto" }}
              >
                {/* ⚠ LA ETIQUETA VA EN UN TOOLTIP porque la columna la RECORTA: los nombres
                    largos —«devolviendo_a_tienda»— se cortan con puntos suspensivos, y sin esto
                    ese texto se pierde. El tooltip lo devuelve entero al pasar por encima o al
                    enfocar con el teclado, sin ensanchar la columna ni descuadrar las barras. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="min-w-0 cursor-default truncate text-left text-muted-foreground" />
                    }
                  >
                    {punto.categoria}
                  </TooltipTrigger>
                  <TooltipContent>{punto.categoria}</TooltipContent>
                </Tooltip>
                <span className="flex" style={{ height: `${ALTO_BARRA}px` }}>
                  <span
                    // La `key` con el valor dentro es lo que hace que la animación vuelva a
                    // correr cuando cambia el dato (ver `GraficaReparto`).
                    key={`${punto.categoria}:${punto.valor}`}
                    className="grafica-barra-crece rounded-xs bg-chart-1"
                    style={{
                      width: `${((punto.valor ?? 0) / mayor) * 100}%`,
                      animationDelay: `${indice * ESCALON_MS}ms`,
                    }}
                  />
                </span>
                <span className="tabular-nums text-foreground">
                  {cifraConPeso(formatearValor(punto.valor, unidad), pesos[indice])}
                </span>
              </li>
            ))}
          </ul>

          <SerieTextual
            series={[serie]}
            unidad={unidad}
            etiqueta={titulo}
            recorteSeries={{ recortado: false, mostrados: 1, recibidos: 1 }}
            recortePuntos={{ recortado: false, mostrados: 0, recibidos: 0 }}
            pesos={pesos}
          />
        </>
      ) : null}
    </GraficaMarco>
  );
}
