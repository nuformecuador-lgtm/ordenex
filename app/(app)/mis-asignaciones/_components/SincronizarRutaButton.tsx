"use client";

// Feature 97 (R25/R31/R32/R34) — botón de sincronización MANUAL de la ruta del mensajero.
// Vive dentro de `RepartoModule`, que solo se monta desde una página que ya hace
// `notFound()` para roles ≠ `mensajero`; la Server Action `sincronizarRuta` vuelve a
// comprobar el rol (`forbidden`) como defensa en profundidad (R33).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";

import type { RutaMapaOrigen, RutaMapaTrazado } from "./ruta-mapa-tipos";

export interface SincronizarRutaButtonProps {
  /**
   * Se invoca con la ubicación capturada por GPS (si el permiso se concedió), para que el
   * padre pueda dibujar el punto de partida en el mapa. Nunca se llama si el permiso se
   * negó o el navegador no expone geolocalización (R25).
   */
  onUbicacion?: (ubicacion: RutaMapaOrigen) => void;
  /**
   * Se invoca con la geometría de la ruta recién calculada, para que el padre la pase al
   * mapa. Se llama siempre que la action traiga trazado — incluso con `omitida: true`, que
   * es el caso de una sola parada (R35): no se reordena nada, pero sí se dibuja la línea.
   * Una ruta que ya estaba al día no produce trazado nuevo, y ahí el mapa conserva el suyo.
   */
  onTrazado?: (trazado: RutaMapaTrazado) => void;
}

/**
 * Captura la ubicación actual del navegador BEST-EFFORT (R25): si `geolocation` no existe,
 * el permiso se niega, o hay timeout/error, resuelve `undefined` en vez de rechazar. Así la
 * sincronización NUNCA queda bloqueada por el permiso: simplemente corre sin `ubicacion`.
 */
function capturarUbicacion(): Promise<RutaMapaOrigen | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(undefined);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function SincronizarRutaButton({
  onUbicacion,
  onTrazado,
}: SincronizarRutaButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);
  // R34 — cerrojo SÍNCRONO anti-doble-click: `disabled` solo engancha tras el re-render, así
  // que un segundo click en el mismo tick lo atraparía igual. El ref cambia YA, en el primer
  // click, y descarta el segundo antes de que llegue a la action facturada.
  const enVueloRef = useRef(false);

  async function handleClick() {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setProcesando(true);
    try {
      const ubicacion = await capturarUbicacion();
      if (ubicacion) onUbicacion?.(ubicacion);
      const result = await sincronizarRuta(ubicacion ? { ubicacion } : {});
      switch (result.status) {
        case "ok":
          // El trazado se eleva ANTES del refresh: `router.refresh()` no toca el estado de
          // cliente, así que la línea nueva sobrevive al re-render del módulo.
          if (result.trazado) {
            onTrazado?.({
              encodedPolyline: result.trazado.encodedPolyline,
              fuente: result.trazado.fuente,
            });
          }
          // Feature 265 (R39/R40/R41/R42) — «Ruta sincronizada.» a secas, con un orden que
          // calculó la app, es una MEDIA VERDAD dicha en el peor momento: justo cuando el
          // mensajero está a punto de salir y ya no va a volver a mirar.
          //
          // Los tres desenlaces son distintos y se dicen distintos:
          //   · `omitida`      → no se recalculó nada, y así se dice;
          //   · orden local    → warning, porque hay algo que revisar antes de salir;
          //   · lo demás       → el mensaje de siempre. `null` (no consta) entra aquí: sin
          //                      dato no se afirma nada de más, pero tampoco se alarma (R45).
          //
          // El aviso PERSISTENTE de la pantalla cubre el mismo hecho y sobrevive al F5; éste
          // es el feedback inmediato, no su sustituto.
          if (result.omitida) {
            toast.success("La ruta ya estaba al día.");
          } else if (result.secuenciaFuente === "local") {
            toast.warning(
              "Ruta ordenada de forma aproximada: revisa el orden de las paradas.",
            );
          } else {
            toast.success("Ruta sincronizada.");
          }
          router.refresh(); // R32: refleja el orden nuevo (módulo server-driven, sin SWR)
          break;
        case "conflict":
          // R34: pulsado dentro del intervalo mínimo, o el proveedor falló y se conservó
          // el último orden válido (R27). Se avisa sin fingir que recalculó.
          toast.warning(result.motivo);
          break;
        case "forbidden":
          toast.error("No tienes permiso para sincronizar la ruta.");
          break;
        case "unauthenticated":
          toast.error("Tu sesión expiró. Inicia sesión de nuevo.");
          break;
        case "validation_error":
          toast.error("No se pudo sincronizar la ruta.");
          break;
      }
    } finally {
      enVueloRef.current = false;
      setProcesando(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={procesando}
      aria-busy={procesando}
    >
      <RefreshCw aria-hidden="true" className={procesando ? "animate-spin" : undefined} />
      {procesando ? "Sincronizando…" : "Sincronizar ruta"}
    </Button>
  );
}
