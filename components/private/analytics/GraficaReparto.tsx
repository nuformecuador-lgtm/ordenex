// REPARTO: una sola barra dividida por color, con su leyenda debajo.
//
// El gráfico de «un todo partido en pocas partes»: los seis desenlaces de una orden, o las
// cargadas de hoy contra las que siguen sin gestionar. Recibe UNA serie con N puntos —cada
// punto es una parte— y dibuja una barra al 100 %.
//
// ─── POR QUÉ ESTO Y NO UN ANILLO (decisión del 2026-08-18) ──────────────────────────────
//
// Un anillo obliga a comparar ÁNGULOS, y el ojo no compara ángulos: compara longitudes sobre
// una misma línea base. Con seis porciones donde tres son pequeñas, en el anillo esas tres se
// vuelven astillas sin etiqueta legible. En una barra al 100 % todas las partes arrancan del
// mismo sitio y la más pequeña conserva su franja, su nombre y su cifra.
//
// ─── SIN RECHARTS, Y NO ES UN ATAJO ─────────────────────────────────────────────────────
//
// Son rectángulos de anchura porcentual: `flex` los hace exactos sin medir el contenedor, sin
// `ResponsiveContainer` y sin arrastrar el chunk de recharts a la pantalla. Por eso este
// archivo tampoco necesita lienzo diferido: se pinta con el primer HTML, no cuando llega el
// JavaScript de la gráfica.
//
// Lo que SÍ se reusa del paquete: `GraficaMarco` (título y los cuatro estados: cargando,
// error, vacío, con datos), `SerieTextual` (la lista para lectores de pantalla),
// `pesosDeReparto` (el reparto por resto mayor, con su ancho) y `paleta` (el color por posición).
// Escribir aquí otro juego de estados los separaría del resto de gráficas a la primera.

import { formatearValor } from "./formato";
import { GraficaMarco } from "./GraficaMarco";
import { varDeSerie } from "./paleta";
import { cifraConPeso, pesosDeReparto, textoDePeso } from "./porcentajes";
import { SerieTextual } from "./SerieTextual";
import type { GraficaProps } from "./tipos";

/** Alto de la barra, en px. Suficiente para que una franja del 2 % siga siendo un rectángulo. */
const ALTO_BARRA = 28;

export function GraficaReparto({
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
  // Con todo a cero no hay reparto que dibujar: una barra vacía y seis ceros en la leyenda se
  // leen como una operación medida, y lo que pasa es que no hubo nada. Cae al estado vacío.
  const hayDatos = puntos.some((punto) => (punto.valor ?? 0) > 0);

  // El ancho de cada franja y el porcentaje que se escribe salen de la misma llamada, pero NO
  // son el mismo número, y las dos veces por un motivo medido:
  //
  // ⚠ (feature 290) ANCHO ≠ CUOTA. Con 1, 0, 0, 1, 0 y 231 sobre 233 las dos categorías de
  // valor 1 pesan 0,429 %, y una podía quedarse con cuota 0: usar ESE cero como anchura
  // borraba de la barra una categoría que sí ocurrió — «1 (0 %)» en la leyenda junto a una
  // franja inexistente. `ancho` le da su astilla a toda parte con valor, descontada del
  // segmento mayor para que la barra siga sumando 100 %.
  //
  // ⚠ (ficha 364) TEXTO ≠ CUOTA. El número escrito es la razón EXACTA, la misma que formatea
  // el KPI «Efectividad de entrega» de esta pantalla: 259 de 877 se escribe 29,5 % en los dos
  // sitios. Escribiendo la cuota del resto mayor la barra decía 30 % y el KPI 29,5 % — dos
  // cifras del mismo hecho a un palmo de distancia. El precio, medido y escrito en la cabecera
  // de `porcentajes.ts`: la suma de los textos puede decir 99,9 o 100,1. La BARRA sigue
  // midiendo 100 exacto, que es donde la suma afirma algo.
  //
  // Un cero de verdad sigue diciendo «0 %» y sigue sin ocupar nada: son dos hechos distintos.
  const pesos = pesosDeReparto(puntos.map((punto) => punto.valor));
  const pesosFormateados = pesos.map((peso) =>
    textoDePeso(peso, (fraccion) => formatearValor(fraccion, "porcentaje")),
  );

  // ⚠ LA FIRMA ES LO QUE HACE QUE LA ANIMACIÓN VUELVA A CORRER. Una animación CSS se dispara al
  // MONTAR el elemento; si solo cambian los anchos, React reusa el mismo nodo y las franjas
  // saltan a su tamaño nuevo sin transición. Con una `key` derivada de las cifras, React
  // desmonta la barra vieja y monta otra, así que la entrada se repite en cada cambio de filtro
  // — y NO en un render que no cambia ningún número, que haría parpadear el gráfico al mover el
  // ratón por encima. Es la misma técnica que `firmaDeSegmentos` usa en el lienzo del donut.
  const firma = puntos.map((punto) => `${punto.categoria}:${punto.valor}`).join("|");

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
          {/* `aria-hidden`: el dibujo no dice nada que la lista de abajo no diga mejor, y
              anunciar seis divs vacíos sería ruido para un lector de pantalla. */}
          <div
            key={firma}
            aria-hidden="true"
            className="grafica-barra-crece flex w-full overflow-hidden rounded-md"
            style={{ height: `${ALTO_BARRA}px` }}
          >
            {puntos.map((punto, indice) => (
              <div
                key={punto.categoria}
                style={{
                  width: `${(pesos[indice]?.ancho ?? 0) * 100}%`,
                  backgroundColor: varDeSerie(indice),
                }}
              />
            ))}
          </div>

          {/* La leyenda lleva la cifra Y el peso pegados al nombre: son los dos datos que se
              vienen a buscar y ninguno obliga a pasar el ratón por encima — en una pantalla
              táctil un tooltip directamente no existe. `flex-wrap` para que con seis entradas
              salte de línea en vez de estrujarse.

              `aria-hidden`: dice EXACTAMENTE lo mismo que la lista de `SerieTextual` de abajo,
              y sin esto un lector de pantalla leería las seis entradas dos veces. La versión
              accesible es aquella —lleva además el nombre de la gráfica en cada línea—; ésta
              es su gemela visible. */}
          <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {puntos.map((punto, indice) => (
              <li key={punto.categoria} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-xs"
                  style={{ backgroundColor: varDeSerie(indice) }}
                />
                <span className="text-muted-foreground">{punto.categoria}</span>
                <span className="tabular-nums text-foreground">
                  {cifraConPeso(formatearValor(punto.valor, unidad), pesosFormateados[indice])}
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
            pesos={pesosFormateados}
          />
        </>
      ) : null}
    </GraficaMarco>
  );
}
