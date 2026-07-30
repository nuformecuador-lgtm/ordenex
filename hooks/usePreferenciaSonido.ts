"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  guardarPreferenciaSonido,
  leerPreferenciaSonido,
} from "@/lib/audio/preferencia-sonido";

// Feature 161 (R16, R18) — la preferencia de sonido como fuente EXTERNA a React.
//
// Se usa `useSyncExternalStore` y no `useState` + efecto a proposito: `localStorage` no
// existe en el servidor, y el componente que la consume (la campana) tambien se renderiza
// alli. Leerla en el primer render daria discrepancia de hidratacion en el dispositivo
// silenciado; leerla en un efecto con `setState` es justo lo que prohibe la regla
// `react-hooks/set-state-in-effect`. Esta es la API que React ofrece para el caso.
//
// Efecto lateral util: al escuchar `storage`, silenciar en una pestana silencia las demas.

/** Evento propio: `storage` NO se dispara en la pestana que escribio. */
const EVENTO_CAMBIO = "ordenex:sonido-notificaciones-cambio";

function suscribir(alCambiar: () => void): () => void {
  window.addEventListener(EVENTO_CAMBIO, alCambiar);
  window.addEventListener("storage", alCambiar);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO, alCambiar);
    window.removeEventListener("storage", alCambiar);
  };
}

/** En servidor no hay preferencia que leer: se asume activado, igual que R15. */
function instantaneaServidor(): boolean {
  return true;
}

export interface UsePreferenciaSonidoResult {
  activado: boolean;
  establecer: (activado: boolean) => void;
}

export function usePreferenciaSonido(): UsePreferenciaSonidoResult {
  const activado = useSyncExternalStore(
    suscribir,
    leerPreferenciaSonido,
    instantaneaServidor,
  );

  const establecer = useCallback((siguiente: boolean) => {
    guardarPreferenciaSonido(siguiente);
    window.dispatchEvent(new Event(EVENTO_CAMBIO));
  }, []);

  return { activado, establecer };
}
