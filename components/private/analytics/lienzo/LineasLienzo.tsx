"use client";

// Lienzo de lineas (ver la nota de `BarrasLienzo.tsx`: recharts directo, Q1).
//
// `connectNulls={false}` es requisito, no estetica: un punto ausente se dibuja
// como HUECO y no se une con una recta que inventaria un dato que no existe (R11).

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { varDeSerie } from "../paleta";
import type { LienzoProps } from "./tipos-lienzo";
import { CLAVE_CATEGORIA, filasDeSeries } from "./filas";

export function LineasLienzo({ series, formatear }: LienzoProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={filasDeSeries(series)}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey={CLAVE_CATEGORIA} stroke="var(--muted-foreground)" tickLine={false} />
        <YAxis stroke="var(--muted-foreground)" tickFormatter={formatear} tickLine={false} />
        <Tooltip formatter={(valor) => formatear(typeof valor === "number" ? valor : null)} />
        <Legend />
        {series.map((serie, indice) => (
          <Line
            key={serie.id}
            type="monotone"
            dataKey={serie.id}
            name={serie.etiqueta}
            stroke={varDeSerie(indice)}
            connectNulls={false}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default LineasLienzo;
