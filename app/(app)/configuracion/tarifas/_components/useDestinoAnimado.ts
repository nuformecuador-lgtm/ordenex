"use client";

import { useEffect, useState } from "react";

// Etiqueta del destino de la tarifa ("Por defecto" / "Zona X") con cambio ANIMADO.
// Los dos tramos van ENCADENADOS, no a la vez:
//   1. "saliendo": la etiqueta actual se va hacia la DERECHA desvaneciéndose;
//   2. al terminar, se conmuta el texto y el nuevo entra desde la IZQUIERDA.
//
// El hook sostiene la etiqueta VIEJA durante el primer tramo (por eso `etiqueta` —la
// que se pinta— no es lo mismo que la pedida) y expone la clase de la fase. Las
// animaciones viven en `globals.css`; las duraciones se leen de las MISMAS variables
// CSS (`--destino-etiqueta-*-ms`) para que no se desincronicen al retocarlas.
//
// Sólo anima el RÓTULO: el formulario carga los valores del destino al instante. Una
// animación no debe retrasar lo que el maestro va a teclear.
//
// `prefers-reduced-motion`: quien pidió menos movimiento ve el cambio de golpe.
//
// No reusa `useTransicionVista` (mis-asignaciones) aunque el encadenado sea el mismo:
// aquél DESCARTA un cambio pedido a mitad de la salida, que allí evita encadenar
// animaciones a medias pero aquí dejaría el rótulo nombrando una zona que ya no es la
// que el formulario está editando —justo lo que este rótulo existe para impedir—.

type Fase = "estable" | "saliendo" | "entrando";

const CLASE_FASE: Record<Fase, string> = {
  estable: "",
  saliendo: "destino-etiqueta-saliendo",
  entrando: "destino-etiqueta-entrando",
};

/** `true` si el usuario pidió menos movimiento (o si no hay `window`, en SSR). */
function prefiereMenosMovimiento(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Duración en ms de una variable CSS del `:root`. Devuelve `respaldo` si la hoja aún
 * no está aplicada o el valor no es legible, para no dejar la etiqueta a medio salir.
 */
function duracionCss(variable: string, respaldo: number): number {
  if (typeof window === "undefined") return respaldo;
  const bruto = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  const ms = bruto.endsWith("ms")
    ? Number.parseFloat(bruto)
    : bruto.endsWith("s")
      ? Number.parseFloat(bruto) * 1000
      : Number.NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : respaldo;
}

export interface DestinoAnimado {
  /** Texto que debe PINTARSE ahora (el viejo mientras dura el tramo de salida). */
  etiqueta: string;
  /** Clase de animación de la fase actual (vacía en reposo). */
  clase: string;
}

export function useDestinoAnimado(pedida: string): DestinoAnimado {
  const [etiqueta, setEtiqueta] = useState(pedida);
  const [fase, setFase] = useState<Fase>("estable");
  // Ultima etiqueta pedida que YA se atendio. Es el patron de React para ajustar
  // estado cuando cambia una prop: se compara en el render y se conmuta ahi mismo,
  // no en un efecto (un efecto haria pintar un fotograma con la fase vieja, y el
  // lint lo rechaza por render en cascada).
  const [atendida, setAtendida] = useState(pedida);

  if (pedida !== atendida) {
    setAtendida(pedida);
    if (prefiereMenosMovimiento()) {
      // Sin animacion no hay tramo que sostener: el rotulo cambia de golpe.
      setEtiqueta(pedida);
      setFase("estable");
    } else {
      setFase("saliendo");
    }
  }

  useEffect(() => {
    if (fase === "estable") return;

    if (fase === "saliendo") {
      const ms = duracionCss("--destino-etiqueta-salida-ms", 150);
      const timer = window.setTimeout(() => {
        // Fin del tramo 1: recien AHORA se conmuta el texto, y entra por la
        // izquierda. Se lee `pedida` del cierre mas reciente, asi que un cambio a
        // mitad de la salida deja el rotulo en el destino que de verdad esta activo.
        setEtiqueta(pedida);
        setFase("entrando");
      }, ms);
      return () => window.clearTimeout(timer);
    }

    // Al acabar la entrada se vuelve a reposo, para que la clase no se quede puesta
    // y la siguiente entrada si re-dispare la animacion.
    const ms = duracionCss("--destino-etiqueta-entrada-ms", 200);
    const timer = window.setTimeout(() => setFase("estable"), ms);
    return () => window.clearTimeout(timer);
  }, [fase, pedida]);

  return { etiqueta, clase: CLASE_FASE[fase] };
}
