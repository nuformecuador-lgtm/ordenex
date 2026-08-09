"use client";

// Feature 192 (F2.2, R29) — la rejilla de tarjetas.
//
// El ORDEN es del DATO, no del ancho de la pantalla: se calcula aqui, sobre el array, y la
// rejilla solo cambia cuantas columnas pinta. Un orden que dependiera del `grid-flow` o de
// un `order-*` por breakpoint haria que la misma pantalla se leyera distinta en el movil del
// supervisor y en el monitor de la bodega.

import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import { MensajeroCard } from "./MensajeroCard";

/**
 * R29 — orden determinista: `asignadas` descendente y, a igualdad, nombre ascendente. El
 * tercer criterio (`mensajeroId`) es el mismo desempate que lleva el `ORDER BY` del SQL:
 * dos mensajeros homonimos con las mismas asignadas no pueden bailar entre refrescos.
 *
 * Devuelve una copia: `readonly FilaTableroDia[]` no se ordena en sitio.
 */
export function ordenarFilasTablero(
  filas: readonly FilaTableroDia[],
): readonly FilaTableroDia[] {
  return [...filas].sort(
    (a, b) =>
      b.asignadas - a.asignadas ||
      a.mensajeroNombre.localeCompare(b.mensajeroNombre, "es") ||
      a.mensajeroId.localeCompare(b.mensajeroId),
  );
}

export function TableroDiaRejilla({
  filas,
  onSeleccionar,
  mensajeroSeleccionadoId = null,
}: Readonly<{
  filas: readonly FilaTableroDia[];
  onSeleccionar: (mensajeroId: string) => void;
  mensajeroSeleccionadoId?: string | null;
}>) {
  const ordenadas = ordenarFilasTablero(filas);

  return (
    <ul
      data-slot="tablero-dia-rejilla"
      className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {ordenadas.map((fila) => (
        <li key={fila.mensajeroId}>
          <MensajeroCard
            fila={fila}
            onSeleccionar={onSeleccionar}
            seleccionado={fila.mensajeroId === mensajeroSeleccionadoId}
          />
        </li>
      ))}
    </ul>
  );
}
