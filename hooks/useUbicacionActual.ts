"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Feature 93 (design §6.3, R22/R25) — captura la ubicacion del navegador para
// usarla como ORIGEN de la ruta optimizada.
//
// Invariante duro (R25): este hook NUNCA bloquea ni aborta nada. Los tres
// desenlaces posibles (concedido / denegado / fallo-timeout) resuelven, y en los
// dos ultimos `coords` queda `null`; quien lo consuma llama IGUAL a la Server
// Action, simplemente sin `ubicacion`, y el backend degrada al fallback de R24
// (ultima conocida -> centroide). Por eso no expone `error`: no hay nada que el
// usuario deba hacer al respecto.

export interface Coords {
  lat: number;
  lng: number;
}

export interface UbicacionActual {
  /** Ultima posicion conocida en esta sesion; `null` mientras no haya ninguna. */
  coords: Coords | null;
  /** `true` si el navegador denego el permiso (PERMISSION_DENIED). */
  denegado: boolean;
  /**
   * Pide la posicion AHORA. Resuelve siempre (nunca rechaza): `null` si el
   * permiso esta denegado, si expira el timeout o si no hay `geolocation`.
   */
  pedirUbicacion: () => Promise<Coords | null>;
}

/** Timeout de la captura. Corto a proposito: el mensajero espera el refresh. */
const TIMEOUT_MS = 8_000;
const MAX_AGE_MS = 60_000;

export function useUbicacionActual(): UbicacionActual {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denegado, setDenegado] = useState(false);
  // Evita `setState` sobre un componente ya desmontado si la respuesta del
  // navegador llega tarde (el usuario puede tardar en aceptar el prompt).
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const pedirUbicacion = useCallback(async (): Promise<Coords | null> => {
    const geo =
      typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) return null;

    return new Promise<Coords | null>((resolve) => {
      let resuelto = false;
      // `function` (hoisted) a proposito: `guarda` se declara despues y la
      // referencia cruzada solo se resuelve cuando el timer dispara.
      function terminar(valor: Coords | null) {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(guarda);
        resolve(valor);
      }
      // Guarda dura: si el navegador no invoca NINGUNA de las dos callbacks
      // (visto con prompts que el usuario deja abiertos), el boton quedaria
      // colgado. La opcion `timeout` nativa no siempre dispara en ese caso.
      const guarda = setTimeout(() => terminar(null), TIMEOUT_MS + 1_000);

      geo.getCurrentPosition(
        (pos) => {
          const siguiente: Coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          if (montado.current) {
            setCoords(siguiente);
            setDenegado(false);
          }
          terminar(siguiente);
        },
        (err: GeolocationPositionError) => {
          // R25: denegacion y timeout se tratan IGUAL de cara al llamador
          // (`null`); `denegado` solo sirve para poder explicarlo en la UI.
          const esDenegado =
            err?.code === 1 /* PERMISSION_DENIED */;
          if (montado.current && esDenegado) setDenegado(true);
          terminar(null);
        },
        { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
      );
    });
  }, []);

  return { coords, denegado, pedirUbicacion };
}
