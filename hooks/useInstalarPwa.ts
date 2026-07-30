"use client";

import { useCallback, useEffect, useState } from "react";

// Feature 164 — instalacion de la PWA desde la propia app.
//
// El navegador YA ofrece instalar (icono en la barra de direcciones, menu "Instalar
// aplicacion"), pero esa via es invisible para quien no la conoce, que es el caso del
// mensajero en la calle. Este hook captura el evento del navegador y deja que la app ofrezca
// el gesto donde se ve.
//
// LIMITE del estandar, no de esta implementacion: `beforeinstallprompt` es de Chromium.
// Safari (iOS incluido) NUNCA lo dispara -- alli la instalacion es manual, Compartir ->
// Anadir a pantalla de inicio -- y Firefox tampoco. En esos navegadores el hook reporta
// `disponible: false` para siempre y quien lo consume no debe pintar nada.

/** El evento no esta en `lib.dom`: es propietario de Chromium. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface UseInstalarPwaResult {
  /** `true` solo si el navegador ofrecio instalar Y aun no se ha instalado. */
  disponible: boolean;
  /** Lanza el dialogo nativo. No hace nada si no hay oferta viva. */
  instalar: () => Promise<void>;
}

export function useInstalarPwa(): UseInstalarPwaResult {
  const [oferta, setOferta] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // El `setState` va en el CALLBACK de la suscripcion, no en el cuerpo del efecto: es
    // exactamente el caso que `react-hooks/set-state-in-effect` permite.
    function alOfrecer(event: Event) {
      // Sin `preventDefault` Chrome muestra su propio aviso ademas del boton de la app.
      event.preventDefault();
      setOferta(event as BeforeInstallPromptEvent);
    }

    // Ya instalada: la oferta deja de tener sentido y el boton desaparece solo.
    function alInstalar() {
      setOferta(null);
    }

    window.addEventListener("beforeinstallprompt", alOfrecer);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alOfrecer);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!oferta) return;
    try {
      await oferta.prompt();
      await oferta.userChoice;
    } catch {
      // El dialogo puede rechazar si ya se consumio. No hay nada que decirle al usuario:
      // el navegador ya le mostro (o no) su propia interfaz.
    }
    // La oferta es de UN SOLO USO: el navegador no vuelve a entregar el mismo evento. Se
    // descarta tanto si acepto (ya esta instalada) como si rechazo (no se le insiste en la
    // misma sesion); si el navegador vuelve a considerarla instalable, emitira otro evento.
    setOferta(null);
  }, [oferta]);

  return { disponible: oferta !== null, instalar };
}
