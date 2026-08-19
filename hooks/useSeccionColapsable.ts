"use client";

import { useCallback, useEffect, useState } from "react";

// Rama ux (pedido humano): las secciones OPCIONALES del detalle del mensajero ("Mi nota",
// "Gestionar esta orden") se muestran y se ocultan como un acordeón, CON animación en los
// dos sentidos.
//
// Vive en `hooks/` desde el pedido humano del 2026-08-19, que sumó un tercer consumidor
// fuera de `/mis-asignaciones`: el compositor del hilo de notas (`components/shared/
// HiloNotasOrden`). Un componente compartido no puede importar de la carpeta privada de una
// ruta, y duplicar el hook habría dejado dos acordeones que se desincronizan al primer ajuste.
//
// El contenido se DESMONTA al cerrar (no basta con `hidden`): dentro vive el escáner QR, y
// un escáner montado a escondidas es justo el bug que ya se arregló una vez (la cámara
// encendida detrás de la pantalla). Por eso el cierre tiene dos tramos: primero corre la
// animación de salida y, al terminar, se desmonta. El hook expone ambas cosas por separado:
//   - `abierta`: el estado LÓGICO (lo que anuncia `aria-expanded`), cambia al instante;
//   - `montada`: si hay que renderizar el contenido (sigue `true` mientras se cierra).
//
// `prefers-reduced-motion`: quien pidió menos movimiento abre y cierra de golpe, sin clases
// de animación ni espera.

/** Duración del tramo de salida, en ms. Debe casar con la clase `duration-200` del cierre. */
const SALIDA_MS = 200;

const CLASE_ENTRADA = "duration-200 animate-in fade-in slide-in-from-top-1";
const CLASE_SALIDA = "duration-200 animate-out fade-out slide-out-to-top-1";

/** `true` si el usuario pidió menos movimiento (o si no hay `window`, en SSR). */
function prefiereMenosMovimiento(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface SeccionColapsable {
  /** Estado lógico de la sección (para `aria-expanded` y para elegir qué control pintar). */
  abierta: boolean;
  /** `true` mientras haya que renderizar el contenido (incluye el cierre en curso). */
  montada: boolean;
  /** Clases de animación del contenedor del contenido. */
  clase: string;
  abrir: () => void;
  cerrar: () => void;
}

export function useSeccionColapsable(inicial = false): SeccionColapsable {
  const [abierta, setAbierta] = useState(inicial);
  // Se separa de `abierta` para sostener el contenido durante el tramo de salida.
  const [montada, setMontada] = useState(inicial);

  const abrir = useCallback(() => {
    setAbierta(true);
    setMontada(true);
  }, []);

  const cerrar = useCallback(() => {
    setAbierta(false);
    // Sin animación no hay tramo de salida que sostener: se desmonta ya.
    if (prefiereMenosMovimiento()) setMontada(false);
  }, []);

  // Tramo de salida: el contenido sigue montado el tiempo de la animación y se desmonta al
  // terminar. El `setState` va DENTRO del timer (la regla `set-state-in-effect` es error en
  // este repo: no se setea estado en el cuerpo del efecto).
  useEffect(() => {
    if (abierta || !montada) return;
    const timer = window.setTimeout(() => setMontada(false), SALIDA_MS);
    return () => window.clearTimeout(timer);
  }, [abierta, montada]);

  return {
    abierta,
    montada,
    clase: abierta ? CLASE_ENTRADA : CLASE_SALIDA,
    abrir,
    cerrar,
  };
}
