"use client";

import { useEffect, useState } from "react";

// Rama ux (pedido humano): cambio ANIMADO entre las vistas de la lista de órdenes
// (mosaico ⇄ detalle). Los dos tramos van ENCADENADOS, no a la vez:
//   1. "saliendo": las cards actuales bajan y se desvanecen (opacidad → 0);
//   2. al terminar, se conmuta la vista y las NUEVAS suben apareciendo (opacidad 0 → 1).
//
// El hook sostiene la vista VIEJA durante el primer tramo (por eso `vista` — la que se
// renderiza — no es lo mismo que la pedida) y expone la fase para que el consumidor pinte
// la clase de animación. Las animaciones viven en `globals.css`; las duraciones se leen de
// las MISMAS variables CSS (`--vista-cards-*-ms`) para que no se desincronicen al retocarlas.
//
// `prefers-reduced-motion`: quien pidió menos movimiento conmuta de golpe, sin fases.

export type FaseTransicion = "estable" | "saliendo" | "entrando";

/** Clase CSS de la fase, para el contenedor de las cards. */
export const CLASE_FASE: Record<FaseTransicion, string> = {
  estable: "",
  saliendo: "vista-cards-saliendo",
  entrando: "vista-cards-entrando",
};

/** `true` si el usuario pidió menos movimiento (o si no hay `window`, en SSR). */
function prefiereMenosMovimiento(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Duración en ms de una variable CSS del `:root` (p. ej. `--vista-cards-salida-ms`).
 * Devuelve `respaldo` si la hoja aún no está aplicada o el valor no es legible, para no
 * dejar la transición colgada por un fallo de lectura.
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

export interface TransicionVista<T> {
  /** Vista que debe RENDERIZARSE ahora (la vieja mientras dura el tramo de salida). */
  vista: T;
  /**
   * Vista PEDIDA. Se adelanta a `vista` durante el tramo de salida para que el control que
   * dispara el cambio (el conmutador) se marque al instante y no parezca que no respondió.
   */
  vistaPedida: T;
  /** Fase actual, para elegir la clase de animación (ver `CLASE_FASE`). */
  fase: FaseTransicion;
  /** Pide cambiar de vista; ignora la petición si ya hay una transición en curso. */
  cambiarVista: (siguiente: T) => void;
}

export function useTransicionVista<T>(inicial: T): TransicionVista<T> {
  const [vista, setVista] = useState<T>(inicial);
  const [fase, setFase] = useState<FaseTransicion>("estable");
  // Vista pedida mientras corre el tramo de salida. Es ESTADO, no un ref: se lee en el
  // render (el conmutador se marca al instante, `vistaPedida`) y leer un ref durante el
  // render no está permitido.
  const [pendiente, setPendiente] = useState<T | null>(null);

  function cambiarVista(siguiente: T) {
    // Nada que hacer si ya es la vista actual o si hay una transición en vuelo (evita
    // encadenar animaciones a medias si el mensajero pulsa dos veces seguidas).
    if (siguiente === vista || fase === "saliendo") return;
    if (prefiereMenosMovimiento()) {
      setVista(siguiente);
      setFase("estable");
      return;
    }
    setPendiente(siguiente);
    setFase("saliendo");
  }

  useEffect(() => {
    if (fase === "estable") return;

    if (fase === "saliendo") {
      const ms = duracionCss("--vista-cards-salida-ms", 180);
      const timer = window.setTimeout(() => {
        // Fin del tramo 1: recién AHORA entran las cards nuevas, subiendo.
        if (pendiente !== null) setVista(pendiente);
        setPendiente(null);
        setFase("entrando");
      }, ms);
      return () => window.clearTimeout(timer);
    }

    const ms = duracionCss("--vista-cards-entrada-ms", 220);
    const timer = window.setTimeout(() => setFase("estable"), ms);
    return () => window.clearTimeout(timer);
  }, [fase, pendiente]);

  return { vista, vistaPedida: pendiente ?? vista, fase, cambiarVista };
}
