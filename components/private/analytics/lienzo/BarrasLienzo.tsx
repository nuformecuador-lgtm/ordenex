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
import type { LienzoProps } from "./tipos-lienzo";
import { CLAVE_CATEGORIA, filasDeSeries } from "./filas";

export function BarrasLienzo({ series, formatear }: LienzoProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={filasDeSeries(series)}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey={CLAVE_CATEGORIA} stroke="var(--muted-foreground)" tickLine={false} />
        <YAxis stroke="var(--muted-foreground)" tickFormatter={formatear} tickLine={false} />
        <Tooltip formatter={(valor) => formatear(typeof valor === "number" ? valor : null)} />
        <Legend />
        {series.map((serie, indice) => (
          <Bar key={serie.id} dataKey={serie.id} name={serie.etiqueta} fill={varDeSerie(indice)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default BarrasLienzo;
