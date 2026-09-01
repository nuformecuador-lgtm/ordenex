"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ficha 344 (T6.3/T9.1) — EL ANCHO VISIBLE del contenedor que scrollea en horizontal por encima
 * de un nodo.
 *
 * POR QUÉ EXISTE, y está MEDIDO en Chromium el 2026-08-31 sobre `/wallet` a 390x844.
 *
 * El detalle de una fila del libro se despliega DENTRO de una celda de la tabla del libro, y esa
 * tabla declara anchos mínimos por columna que suman ~1.104 px. El resultado: el panel hereda
 * **1.080 px de ancho** aunque la ventana tenga 390 y el hueco visible sea de **308**. Su propia
 * tabla no desborda —el juego de columnas de móvil la deja en desborde 0— pero la columna del
 * APORTE, que va a la derecha, aterriza en `x=[1064, 1108]`: **674 px fuera del área visible**.
 * El importe está entero en el DOM y no se puede LEER sin arrastrar el libro entero de lado.
 *
 * Eso es peor que el defecto que la ficha 343 midió (allí eran 25 px), y es exactamente lo que
 * `R50` prohíbe. La causa no es el juego de columnas —que funciona— sino el ANCHO HEREDADO.
 *
 * QUÉ HACE ESTE HOOK: devuelve el `clientWidth` del ancestro que scrollea en horizontal, para
 * que el panel se pueda ACOTAR a él (`max-width`) y quedarse pegado a su borde izquierdo
 * (`position: sticky; left: 0`). Medido después del cambio, a 390x844: la sección pasa de 1.080
 * a 308 px, el aporte a `x=[292, 336]` —dentro de la ventana—, el desborde del panel sigue en 0
 * y con el libro arrastrado 600 px a la derecha el importe SIGUE dentro (`x=[280, 324]`), que es
 * lo que aporta el `sticky` frente a un simple `max-width`.
 *
 * `max-width` y NO `width`: acotar sólo puede ENCOGER. A 1440 el ancestro mide 1.102 y la
 * sección 1.080, así que no cambia ni un píxel — el escritorio se queda como estaba.
 *
 * Devuelve `null` mientras no haya medida (servidor, primer render, o ningún ancestro con
 * scroll): quien lo use no debe aplicar entonces NINGÚN estilo, para que la ausencia de medida
 * nunca colapse el panel a cero.
 */

/** La clase con la que este repo marca un contenedor que scrollea en horizontal. */
const SELECTOR_SCROLLER = ".overflow-x-auto";

export interface AnchoDelScrollHorizontal<T extends HTMLElement> {
  /** Ref que hay que colgar del nodo cuyo ancestro con scroll se quiere medir. */
  ref: (nodo: T | null) => void;
  /** `clientWidth` del ancestro con scroll, o `null` si todavía no hay medida fiable. */
  ancho: number | null;
}

export function useAnchoDelScrollHorizontal<
  T extends HTMLElement,
>(activo: boolean): AnchoDelScrollHorizontal<T> {
  const [ancho, setAncho] = useState<number | null>(null);
  const nodoRef = useRef<T | null>(null);
  const limpiarRef = useRef<(() => void) | null>(null);

  const observar = useCallback(
    (nodo: T | null) => {
      limpiarRef.current?.();
      limpiarRef.current = null;
      nodoRef.current = nodo;

      if (!activo || nodo === null) {
        setAncho(null);
        return;
      }

      const scroller = nodo.closest<HTMLElement>(SELECTOR_SCROLLER);
      if (scroller === null) {
        setAncho(null);
        return;
      }

      // Una medida de 0 no es una medida: es «todavía no». Aplicarla dejaría el panel sin ancho.
      const medir = () => setAncho(scroller.clientWidth > 0 ? scroller.clientWidth : null);
      medir();

      if (typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(medir);
      ro.observe(scroller);
      limpiarRef.current = () => ro.disconnect();
    },
    [activo],
  );

  // Al cambiar `activo` (el usuario gira el teléfono, o cruza el corte de 768 px) hay que volver
  // a observar el MISMO nodo: la ref de callback no se vuelve a invocar por sí sola.
  useEffect(() => {
    observar(nodoRef.current);
    return () => {
      limpiarRef.current?.();
      limpiarRef.current = null;
    };
  }, [observar]);

  return { ref: observar, ancho };
}
