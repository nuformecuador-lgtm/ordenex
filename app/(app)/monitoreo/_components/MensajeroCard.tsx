"use client";

// Feature 192 (F2.2) — tarjeta de UN mensajero del tablero del dia.
//
// Sobre la primitiva `components/ui/card` (shadcn): NO se crea una primitiva nueva.
// Cabecera: nombre + `asignadas`. Cuerpo: los ocho contadores restantes, con los tres
// buckets de "sin resultado" visualmente separados de los cinco desenlaces (R28).
//
// Componente PURO: todo entra por props, incluido el manejador del click. No conoce
// Server Actions, ni SWR, ni la URL: quien lo monta decide que pasa al pulsarlo.

import type { KeyboardEvent } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import { ContadoresTablero } from "./ContadoresTablero";

const ETIQUETA_ASIGNADAS = "Asignadas";
/** Se lee con lector de pantalla como parte del nombre accesible del control. */
const ACCION_TARJETA = "ver el detalle de sus órdenes de hoy";

export interface MensajeroCardProps {
  readonly fila: FilaTableroDia;
  /** R47 — la tarjeta ENTERA es el control; el padre decide que hace el click. */
  readonly onSeleccionar: (mensajeroId: string) => void;
  readonly seleccionado?: boolean;
}

export function MensajeroCard({
  fila,
  onSeleccionar,
  seleccionado = false,
}: MensajeroCardProps) {
  // Un `onClick` sobre un `div` NO es un boton: sin esto la tarjeta seria inalcanzable
  // para quien navega con teclado. `role="button"` + `tabIndex={0}` + Enter/Espacio es el
  // contrato WAI-ARIA de un boton personalizado.
  const alPulsarTecla = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    evento.preventDefault();
    onSeleccionar(fila.mensajeroId);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${fila.mensajeroNombre}: ${fila.asignadas} ${ETIQUETA_ASIGNADAS.toLowerCase()} hoy — ${ACCION_TARJETA}`}
      data-mensajero={fila.mensajeroId}
      data-seleccionado={seleccionado ? "" : undefined}
      onClick={() => onSeleccionar(fila.mensajeroId)}
      onKeyDown={alPulsarTecla}
      className={cn(
        "cursor-pointer text-left transition-shadow",
        // Foco VISIBLE: sin esto el teclado navega a ciegas.
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "hover:ring-foreground/20",
        seleccionado && "ring-2 ring-primary",
      )}
    >
      <CardHeader>
        <CardTitle>{fila.mensajeroNombre}</CardTitle>
        <CardAction>
          <div className="flex flex-col items-end" data-contador="asignadas">
            <span className="text-2xl leading-none font-semibold tabular-nums">
              {fila.asignadas}
            </span>
            <span className="text-xs text-muted-foreground">{ETIQUETA_ASIGNADAS}</span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ContadoresTablero contadores={fila} />
      </CardContent>
    </Card>
  );
}
