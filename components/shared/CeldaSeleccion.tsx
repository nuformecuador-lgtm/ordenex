"use client";

import { CircleAlert } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface CeldaSeleccionProps {
  /** `true` si la fila está marcada. La selección la posee el listado, no esta celda. */
  checked: boolean;
  /** Toggle de ESTA fila. No se invoca nunca si hay `bloqueo`. */
  onCheckedChange: (checked: boolean) => void;
  /**
   * Motivo por el que la fila NO se puede marcar, ya redactado y legible. `null` (o
   * ausente) = se puede marcar.
   *
   * Es un TEXTO y no un booleano a propósito: una casilla que no se puede marcar sin decir
   * por qué es indistinguible de una que no funciona, y ese fue el reporte que originó este
   * componente.
   */
  bloqueo?: string | null;
  /** Nombre accesible del checkbox cuando la fila SÍ se puede marcar. */
  ariaLabel: string;
  /**
   * Nombre accesible del aviso cuando la fila está bloqueada. Por defecto es el propio
   * motivo; se pasa aparte cuando conviene nombrar la fila («No se puede seleccionar la
   * orden REM-7: …»), porque el motivo solo no dice de qué fila habla.
   */
  bloqueoAriaLabel?: string;
}

/**
 * La celda de la columna de selección de un `DataTable`: o un checkbox, o —si la fila está
 * bloqueada— un aviso «!» con el motivo en un tooltip.
 *
 * Pedido humano (2026-08-19): con bloqueo NO se pinta el checkbox. Antes se pintaba
 * deshabilitado con el motivo en el `title` nativo, y eso tenía dos problemas medidos: una
 * casilla gris se lee como «esto no funciona» en vez de «esto no aplica aquí», y el `title`
 * del navegador tarda ~1 s, no sale con el teclado y no se puede leer en táctil. Un icono
 * es una AFIRMACIÓN («aquí no se marca, y por esto») donde la casilla gris era una ausencia.
 *
 * El icono es FOCALIZABLE (`tabIndex=0`) porque un tooltip que solo responde al ratón deja
 * el motivo fuera del alcance de quien navega con teclado — el motivo es la información, no
 * un adorno. No es un `button`: no ejecuta nada, y anunciarlo como botón prometería una
 * acción que no existe.
 *
 * Vive en `components/shared` y no en el listado de órdenes porque la regla es del
 * DataTable, no de un dominio: cualquier tabla con filas bloqueadas la hereda pasando el
 * motivo, sea cual sea.
 */
export function CeldaSeleccion({
  checked,
  onCheckedChange,
  bloqueo = null,
  ariaLabel,
  bloqueoAriaLabel,
}: Readonly<CeldaSeleccionProps>) {
  if (bloqueo !== null && bloqueo !== "") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              role="img"
              aria-label={bloqueoAriaLabel ?? bloqueo}
              // `size-4` = el tamaño del checkbox al que sustituye: la columna no cambia de
              // ancho ni las filas de alto según estén bloqueadas o no.
              className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleAlert className="size-4" aria-hidden="true" />
            </span>
          }
        />
        <TooltipContent>{bloqueo}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Checkbox
      checked={checked}
      onCheckedChange={(valor) => onCheckedChange(valor === true)}
      aria-label={ariaLabel}
    />
  );
}
