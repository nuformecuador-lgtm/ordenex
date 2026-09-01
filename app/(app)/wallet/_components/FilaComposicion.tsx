"use client";

import { useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

import type { ComposicionFilaId } from "@/lib/types/wallet";
import { cn } from "@/lib/utils";

import { DETALLE_FILA_NOMBRE } from "./composicion-detalle-labels";
import { DetalleFilaComposicion } from "./DetalleFilaComposicion";
import type { WalletFiltrosValue } from "./WalletFiltros";
import { money } from "./wallet-labels";

// Ficha 339 (T5.3, design 5.1/5.2) — UNA fila de concepto de la tarjeta de la ganancia,
// convertida en DISCLOSURE: el rotulo pasa a ser un `<button>` con `aria-expanded` y
// `aria-controls`, y al abrirlo aparece un panel con sus movimientos DEBAJO, dentro del mismo
// contenedor de la fila.
//
// UNA SOLA PIEZA PARA LAS DOS COLUMNAS, y no una copia en cada una: la logica de apertura, los
// `id` y los `aria-controls` duplicados son justo lo que diverge a los tres meses. Lo unico que
// distingue a una columna de la otra es el `tono` del importe, que entra por prop.
//
// LO QUE NO CAMBIA, y es lo que sostiene las aserciones heredadas de las fichas 45, 158 y 231:
// la fila sigue siendo un `<div>` hijo directo de la `<dl role="group">` de su columna, con su
// `<dt>` (el rotulo) y su `<dd>` (el importe) dentro y en ese orden. Convertir la tarjeta en
// tablas habria roto el `role="group"`, su `aria-label` y la estructura `<dt>`/`<dd>` sobre los
// que miden tres features anteriores (design 10-A5).
//
// R21/R22 — EL PANEL SE MONTA SOLO SI LA FILA ESTA ABIERTA. No se renderiza escondido con
// `hidden`: el `useSWR` vive DENTRO de `DetalleFilaComposicion`, asi que montarlo cerrado
// costaria una lectura por cada una de las catorce filas de la tarjeta. Cerrada, esta fila
// cuesta exactamente cero.
//
// Money-safe (R35): el importe llega como STRING del servidor y se pinta TAL CUAL con `money`.

/** El color del importe segun de que columna sea la fila. Verde entra, rojo sale. */
const TONO_CLASE: Record<"ingreso" | "egreso", string> = {
  ingreso: "text-success-strong",
  egreso: "text-danger-strong",
};

export interface FilaComposicionProps {
  /** El TOKEN con el que el SERVIDOR sabe que movimientos componen esta fila. */
  fila: ComposicionFilaId;
  /** Rotulo legible de la fila (R5: nunca el valor del enum). */
  label: string;
  /** El importe de la fila, STRING del servidor, pintado tal cual. */
  valor: string;
  icono: LucideIcon;
  /** De que columna es la fila. Solo decide el color del importe. */
  tono: "ingreso" | "egreso";
  /** Los filtros vigentes de la wallet, que bajan hasta el detalle (R20). */
  filtros: WalletFiltrosValue;
  /**
   * R10 — aclaracion opcional bajo el importe. Hoy solo la lleva «Otros gastos de Ordenex»,
   * cuando el SERVIDOR dice que ahi queda dinero sin clasificar.
   */
  pista?: string;
}

export function FilaComposicion({
  fila,
  label,
  valor,
  icono: Icono,
  tono,
  filtros,
  pista,
}: FilaComposicionProps) {
  const [abierta, setAbierta] = useState(false);
  const panelId = `composicion-detalle-${fila}`;

  return (
    <div
      className={cn(
        "mx-2 grid grid-cols-[1fr_auto] items-center gap-x-4 rounded-md px-2 py-1.5",
        "transition-colors duration-200",
        abierta ? "bg-muted/50" : "hover:bg-muted/50",
      )}
    >
      <dt className="min-w-0 text-sm text-muted-foreground">
        {/* R24 — el nombre accesible identifica SU fila y no es un «Ver detalle» repetido
            catorce veces. Contiene ademas el rotulo VISIBLE del boton, que es lo que exige
            «Label in Name»: quien maneja la app por voz dice lo que lee. */}
        <button
          type="button"
          onClick={() => setAbierta((previo) => !previo)}
          aria-expanded={abierta}
          aria-controls={panelId}
          aria-label={DETALLE_FILA_NOMBRE.abrir(label)}
          className="flex w-full items-center gap-2 rounded-md text-left outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 transition-transform", abierta && "rotate-90")}
            aria-hidden="true"
          />
          <Icono className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </button>
      </dt>

      <dd className={cn("text-sm font-medium tabular-nums", TONO_CLASE[tono])}>
        {money(valor)}
      </dd>

      {/* R10 — la pista va en su propio `<dd>` y NO dentro del rotulo: el `<dt>` es el contrato
          de nombre de la fila y las suites de las fichas 45/158/231 lo leen entero. */}
      {pista ? (
        <dd className="col-span-2 px-1 pt-1 text-xs text-muted-foreground">{pista}</dd>
      ) : null}

      {/* R21/R22 — montado SOLO al abrir: cerrado, cero lecturas. */}
      {abierta ? (
        <dd className="col-span-2 mt-2">
          <DetalleFilaComposicion
            id={panelId}
            fila={fila}
            etiqueta={label}
            filtros={filtros}
          />
        </dd>
      ) : null}
    </div>
  );
}
