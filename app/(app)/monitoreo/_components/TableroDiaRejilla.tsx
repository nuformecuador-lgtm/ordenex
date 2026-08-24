"use client";

// Feature 192 (F2.2, R29) — la rejilla de tarjetas.
//
// El ORDEN es del DATO, no del ancho de la pantalla: se calcula aqui, sobre el array, y la
// rejilla solo cambia cuantas columnas pinta. Un orden que dependiera del `grid-flow` o de
// un `order-*` por breakpoint haria que la misma pantalla se leyera distinta en el movil del
// supervisor y en el monitor de la bodega.

import type { FilaTableroDia } from "@/lib/types/tablero-dia";
import { cn } from "@/lib/utils";

import { DENSIDAD_INICIAL, type DensidadTablero } from "./densidad";
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
  densidad = DENSIDAD_INICIAL,
}: Readonly<{
  filas: readonly FilaTableroDia[];
  onSeleccionar: (mensajeroId: string) => void;
  mensajeroSeleccionadoId?: string | null;
  /**
   * R45 — Feature 258. La densidad SOLO cambia cuantas columnas y cuanto `gap`; el ORDEN se
   * sigue calculando aqui sobre el array y no depende de ella ni del ancho (R6).
   */
  densidad?: DensidadTablero;
}>) {
  const ordenadas = ordenarFilasTablero(filas);

  return (
    <ul
      data-slot="tablero-dia-rejilla"
      data-densidad={densidad}
      className={cn(
        "grid list-none grid-cols-1",
        densidad === "compacta"
          ? "gap-2 sm:grid-cols-2 xl:grid-cols-4"
          : "gap-3 sm:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {ordenadas.map((fila) => (
        <li key={fila.mensajeroId}>
          <MensajeroCard
            fila={fila}
            onSeleccionar={onSeleccionar}
            seleccionado={fila.mensajeroId === mensajeroSeleccionadoId}
            densidad={densidad}
          />
        </li>
      ))}
    </ul>
  );
}
