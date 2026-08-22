"use client";

// Feature 192 (F2.2) + Feature 258 (F4.3) — tarjeta de UN mensajero del tablero del dia.
//
// Sobre la primitiva `components/ui/card` (shadcn): NO se crea una primitiva nueva.
// Cabecera: avatar de iniciales + nombre + `asignadas`. Cuerpo: la barra de composicion y los
// ocho contadores restantes, con los tres cubos de "sin resultado" visualmente separados de
// los cinco desenlaces (R4/R28).
//
// Componente PURO: todo entra por props, incluido el manejador del click. No conoce
// Server Actions, ni SWR, ni la URL: quien lo monta decide que pasa al pulsarlo.

import type { KeyboardEvent } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import { ContadoresTablero } from "./ContadoresTablero";
import { DENSIDAD_INICIAL, type DensidadTablero } from "./densidad";
import { iniciales } from "./filtrar-mensajeros";

const ETIQUETA_ASIGNADAS = "Asignadas";
/** Se lee con lector de pantalla como parte del nombre accesible del control. */
const ACCION_TARJETA = "ver el detalle de sus órdenes de hoy";
/** Prefijo del nombre accesible de la barra de composicion de ESTA tarjeta (R68). */
const COMPOSICION_DE = "Composición de";

export interface MensajeroCardProps {
  readonly fila: FilaTableroDia;
  /** R47 — la tarjeta ENTERA es el control; el padre decide que hace el click. */
  readonly onSeleccionar: (mensajeroId: string) => void;
  readonly seleccionado?: boolean;
  /** R44/R45 — presentacion pura: no cambia ninguna cifra ni el orden de nada. */
  readonly densidad?: DensidadTablero;
}

export function MensajeroCard({
  fila,
  onSeleccionar,
  seleccionado = false,
  densidad = DENSIDAD_INICIAL,
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
      // R31 — con el detalle abierto la tarjeta esta "pulsada": el estado de seleccion que ya
      // se veia con el anillo tambien se OYE, en vez de ser solo color.
      aria-pressed={seleccionado}
      // FEATURE 259 (T7.2) — R24/R25: «asignadas hoy» → «asignadas PARA hoy». El tablero cuenta
      // por el dia para el que se asigno la orden, no por el dia en que se asigno; lo que dejo de
      // ser cierto es el «hoy», no el contador. `ETIQUETA_ASIGNADAS` NO se toca a proposito.
      aria-label={`${fila.mensajeroNombre}: ${fila.asignadas} ${ETIQUETA_ASIGNADAS.toLowerCase()} para hoy — ${ACCION_TARJETA}`}
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
        densidad === "compacta" && "gap-3 py-3",
      )}
    >
      <CardHeader className={cn(densidad === "compacta" && "px-3")}>
        {/*
          ⚠️ `min-w-0` NO ES DECORATIVO: es lo que deja encoger la columna del titulo.
          `CardHeader` es una rejilla `grid-cols-[1fr_auto]`, y `1fr` es `minmax(auto, 1fr)`:
          su minimo es el MIN-CONTENT del item. Como este titulo es un flex con el avatar
          (`shrink-0`, 28 px) y el nombre en `nowrap` (por el `truncate`), ese min-content valia
          175 px y la columna se negaba a bajar de ahi. Con la barra lateral aun desplegada y la
          rejilla ya en dos columnas —entre ~768 y ~830 px— la tarjeta cae a ~226 px y la
          cabecera pedia 259: se desbordaba, y como `Card` es `overflow-hidden` y el shell usa
          `overflow-x-clip`, lo que sobraba DESAPARECIA sin barra de scroll. Medido: el «13» de
          asignadas se leia «1» y «Asignadas» se leia «Asignada».
          Con `min-w-0` el minimo automatico desaparece, la columna encoge y el `truncate` del
          nombre hace su trabajo: el NOMBRE cede con puntos suspensivos —es un nombre propio y
          ahi la elipsis es aceptable— y la cifra no se toca.
        */}
        <CardTitle className="flex min-w-0 items-center gap-2">
          {/*
            R71 — avatar DECORATIVO. Las iniciales no identifican a nadie por si solas y el
            nombre completo sigue ahi como texto, asi que el avatar va `aria-hidden`: leerlo
            haria que un lector de pantalla dijera «A R Ana Rojas».
          */}
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[0.7rem] font-semibold text-muted-foreground"
          >
            {iniciales(fila.mensajeroNombre)}
          </span>
          <span className="min-w-0 truncate">{fila.mensajeroNombre}</span>
        </CardTitle>
        <CardAction>
          {/*
            La cifra titular NO cede NUNCA, igual que las de los ocho contadores: `shrink-0`
            deja explicito que quien absorbe el estrechon es el nombre, no el numero.
          */}
          <div className="flex shrink-0 flex-col items-end" data-contador="asignadas">
            <span className="text-2xl leading-none font-semibold tabular-nums">
              {fila.asignadas}
            </span>
            <span className="text-xs text-muted-foreground">{ETIQUETA_ASIGNADAS}</span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className={cn(densidad === "compacta" && "px-3")}>
        <ContadoresTablero
          contadores={fila}
          densidad={densidad}
          etiquetaComposicion={`${COMPOSICION_DE} ${fila.mensajeroNombre}`}
        />
      </CardContent>
    </Card>
  );
}
