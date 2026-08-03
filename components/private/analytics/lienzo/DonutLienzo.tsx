"use client";

// Lienzo de donut (ver la nota de `BarrasLienzo.tsx`: recharts directo, Q1).
//
// En un donut el color NO distingue series sino SEGMENTOS, asi que el techo de
// `MAX_SERIES` se aplica a los segmentos: cinco tokens, cinco porciones, ninguna
// repetida. Lo hace `GraficaDonut` antes de llegar aqui; el lienzo solo colorea
// por posicion.

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { varDeSerie } from "../paleta";
import type { LienzoProps } from "./tipos-lienzo";

export function DonutLienzo({ series, formatear }: LienzoProps) {
  const segmentos = (series[0]?.puntos ?? []).map((punto) => ({
    name: punto.categoria,
    value: punto.valor,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={segmentos} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%">
          {segmentos.map((segmento, indice) => (
            <Cell key={segmento.name} fill={varDeSerie(indice)} />
          ))}
        </Pie>
        <Tooltip formatter={(valor) => formatear(typeof valor === "number" ? valor : null)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default DonutLienzo;
