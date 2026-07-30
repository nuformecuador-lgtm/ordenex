"use client";

import type { KeyboardEvent, MouseEvent } from "react";

// POS card · gate de SELECCIÓN de la card, extraído de `PosOrderCard` para que las
// tres vistas (completa, mosaico, detalle) se comporten igual sin duplicar el
// tratamiento de eventos.
//
// La card contiene sus PROPIOS controles (el enlace "Ir", el desplegable del detalle,
// el pin del mapa), y un `<article>` clickeable no puede envolverlos en un botón sin
// producir HTML inválido: se queda como `<article>` con `aria-label` + `tabIndex` en
// lugar de `role="button"`. El click se ignora cuando nace dentro de un control:
// navegar o abrir el detalle NO debe seleccionar de rebote.

/** `true` si el evento nació dentro de un control interno de la card. */
export function nacidoEnControl(target: EventTarget | null): boolean {
  return Boolean(
    (target as HTMLElement | null)?.closest("a, button, input, summary, label"),
  );
}

export interface PosSeleccionOptions {
  /** Selecciona la orden. Ausente ⇒ card de solo-visualización. */
  onGestionar?: () => void;
  /** Mensajero bloqueado por cierre pendiente: la card no selecciona. */
  bloqueado?: boolean;
}

export interface PosSeleccionHandlers {
  /** `true` si la card responde a puntero/teclado. */
  seleccionable: boolean;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Handlers de selección de una card POS: click en cualquier zona que no sea un
 * control interno, con paridad de teclado (Enter/Espacio sobre la card misma).
 */
export function posSeleccionHandlers({
  onGestionar,
  bloqueado = false,
}: PosSeleccionOptions): PosSeleccionHandlers {
  const seleccionable = Boolean(onGestionar) && !bloqueado;

  return {
    seleccionable,
    onClick(event) {
      if (!seleccionable) return;
      if (nacidoEnControl(event.target)) return;
      onGestionar?.();
    },
    onKeyDown(event) {
      if (!seleccionable) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      // Solo cuando la tecla nace en la card misma: no secuestrar los controles internos.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onGestionar?.();
    },
  };
}
