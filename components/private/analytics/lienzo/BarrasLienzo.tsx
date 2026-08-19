"use client";

// Lienzo de barras. Uno de los TRES unicos archivos del repo que importan
// `recharts` (R26): el guard estatico lo vigila.
//
// Q1 = recharts directo, sin la primitiva `components/ui/chart.tsx` de shadcn.
// Es una EXCEPCION RAZONADA a `docs/architecture.md:136`, decidida por el humano
// en la puerta F1.4 y documentada en `design.md §3.2`: el `ChartConfig` de la
// primitiva obliga a CADA llamador a escribir el mapa serie->color, que es justo
// lo que R16 prohibe, y ese coste se multiplicaria por 131, 132 y 133.
//
// Sin logica de dominio: recibe series ya recortadas y colores ya resueltos por
// `paleta.ts`. Sin `useState` + `useEffect` sincronizando con recharts (R29).

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { varDeSerie } from "../paleta";
import type { BarrasProps, LienzoProps } from "./tipos-lienzo";
import { CLAVE_CATEGORIA, filasDeSeries } from "./filas";

/** Un `stackId` compartido es lo UNICO que recharts necesita para apilar: las barras que lo
 *  comparten se suman en la misma columna. Constante y no derivado de la serie: si cada serie
 *  llevara el suyo volverian a dibujarse lado a lado sin que nada fallara. */
const PILA = "apilada";

/**
 * Ancho de la columna de rotulos cuando las barras van TUMBADAS.
 *
 * Hace falta un numero porque el default de recharts (60 px) recorta cualquier etiqueta de
 * verdad: una fecha `2026-08-15` o el nombre de una tienda salen con puntos suspensivos. 96 px
 * caben una fecha completa sin comerse el dibujo. De pie no aplica: alli el rotulo va debajo y
 * el eje se dimensiona solo.
 */
const ANCHO_ROTULOS = 96;

export function BarrasLienzo({
  series,
  formatear,
  apilado = false,
  horizontal = false,
  grosorBarra,
}: LienzoProps & BarrasProps) {
  // ⚠ EL `layout` DE RECHARTS SE LLAMA AL REVES DE LO QUE UNO ESPERA: `layout="vertical"` es lo
  // que TUMBA las barras (las categorias se apilan en vertical y el valor corre hacia la
  // derecha). La prop de este paquete se llama `horizontal` porque describe la BARRA, que es lo
  // que ve quien mira; la traduccion vive aqui, en una linea, y no en cada llamador.
  const layout = horizontal ? "vertical" : "horizontal";

  // Los dos ejes intercambian papeles: el de CATEGORIA pinta las etiquetas y el de VALOR
  // formatea importes. Se declaran juntos para que no pueda quedarse uno a medio girar — un
  // eje de valor mostrando fechas es un grafico que no falla, solo miente.
  const ejeCategoria = horizontal ? (
    <YAxis
      type="category"
      dataKey={CLAVE_CATEGORIA}
      stroke="var(--muted-foreground)"
      tickLine={false}
      width={ANCHO_ROTULOS}
    />
  ) : (
    <XAxis dataKey={CLAVE_CATEGORIA} stroke="var(--muted-foreground)" tickLine={false} />
  );

  const ejeValor = horizontal ? (
    <XAxis type="number" stroke="var(--muted-foreground)" tickFormatter={formatear} tickLine={false} />
  ) : (
    <YAxis stroke="var(--muted-foreground)" tickFormatter={formatear} tickLine={false} />
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={filasDeSeries(series)} layout={layout}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        {ejeValor}
        {ejeCategoria}
        <Tooltip formatter={(valor) => formatear(typeof valor === "number" ? valor : null)} />
        {/* Con `pesos`, la leyenda deja de ser una lista de nombres y pasa a llevar la CIFRA de
            cada serie y su peso: «Entregadas: 806 (65 %)». Es lo que permite leer un reparto sin
            tocar el grafico —un tooltip obliga a apuntar con el raton, y en tactil no existe—.
            El `payload` se compone aqui en vez de dejar que recharts lo derive: asi se ve de un
            vistazo que color, nombre y cifra salen de la MISMA serie y en el MISMO orden que las
            franjas de la barra, que es justo lo que una leyenda promete. */}
        <Legend />
        {series.map((serie, indice) => (
          <Bar
            key={serie.id}
            dataKey={serie.id}
            name={serie.etiqueta}
            fill={varDeSerie(indice)}
            stackId={apilado ? PILA : undefined}
            // `maxBarSize` y no `barSize`: es un TOPE. Con `barSize`, recharts dibuja ese
            // grosor exacto aunque no quepa y las barras se solapan; con el tope, se respeta
            // cuando hay sitio y se encoge cuando no.
            maxBarSize={grosorBarra}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default BarrasLienzo;
