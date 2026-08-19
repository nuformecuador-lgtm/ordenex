"use client";

// Feature 92 (seguimiento) — botón del TRAYECTO EN VIVO: de donde está el mensajero a la
// siguiente parada, por calles.
//
// ═══ POR QUE ESTO ES UN BOTON Y NO ALGO AUTOMATICO ═══
// Es la única llamada de la feature que NO se puede cachear: arranca en la posición actual,
// así que en cuanto el mensajero se mueve el resultado anterior deja de ser el suyo. Cada
// pulsación es una llamada FACTURADA nueva. Dispararlo al abrir el detalle, o en un
// intervalo, convertiría un gasto acotado en uno proporcional al trasteo con la pantalla.
//
// El resto del mapa —la ruta entera y el tramo resaltado— ya sale gratis de lo persistido;
// esto solo se pide cuando el mensajero QUIERE saber por dónde ir desde donde está ahora.
import { useRef, useState } from "react";
import { Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { trazarTramoVivo } from "@/lib/actions/ruta-mensajero";

import type { RutaMapaOrigen } from "./ruta-mapa-tipos";

export interface TrayectoVivoButtonProps {
  /**
   * Posición actual. `null` deshabilita el botón: sin punto de partida no hay trayecto que
   * pedir, y llamar para que falle sería pagar por un error. NO se pide GPS desde aquí —
   * R25: el permiso lo concede (o no) el botón de sincronizar.
   */
  ubicacion: RutaMapaOrigen | null;
  /** Orden de la SIGUIENTE parada. `null` cuando no queda ninguna por gestionar. */
  ordenId: string | null;
  /** Recibe la polilínea del trayecto para que el mapa la resalte. */
  onTrayecto: (encodedPolyline: string) => void;
}

/** Formatea metros para el aviso. Sin decimales por debajo del kilómetro: nadie los lee. */
function formatearDistancia(m: number | null): string | null {
  if (m === null) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Formatea segundos a minutos redondeados hacia arriba: «0 min» no ayuda a nadie. */
function formatearDuracion(s: number | null): string | null {
  if (s === null) return null;
  return `${Math.max(1, Math.ceil(s / 60))} min`;
}

export function TrayectoVivoButton({
  ubicacion,
  ordenId,
  onTrayecto,
}: TrayectoVivoButtonProps) {
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);
  // Cerrojo SÍNCRONO anti-doble-click, igual que en `SincronizarRutaButton`: `disabled` solo
  // engancha tras el re-render, así que un segundo click en el mismo tick pasaría. Esto no
  // sustituye a la guarda del servidor —la action es un endpoint— pero evita el gasto que
  // sí depende del botón.
  const enVueloRef = useRef(false);

  const listo = ubicacion !== null && ordenId !== null;

  async function handleClick() {
    if (enVueloRef.current || !listo) return;
    enVueloRef.current = true;
    setProcesando(true);
    try {
      const result = await trazarTramoVivo({ ubicacion, ordenId });
      switch (result.status) {
        case "ok": {
          onTrayecto(result.encodedPolyline);
          const partes = [
            formatearDistancia(result.distanciaM),
            formatearDuracion(result.duracionS),
          ].filter((p): p is string => p !== null);
          toast.success(
            partes.length > 0
              ? `Trayecto a la siguiente parada: ${partes.join(" · ")}`
              : "Trayecto a la siguiente parada.",
          );
          break;
        }
        case "conflict":
          toast.warning(result.motivo);
          break;
        case "forbidden":
          toast.error("No se puede calcular el trayecto a esa parada.");
          break;
        case "unauthenticated":
          toast.error("Tu sesión expiró. Vuelve a iniciar sesión.");
          break;
        case "validation_error":
          toast.error("No se pudo leer tu ubicación.");
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
      loading={procesando}
      disabled={!listo}
      // El motivo de que esté deshabilitado no es obvio mirándolo: sin esto el mensajero
      // solo ve un botón muerto y no sabe que le falta conceder el GPS.
      title={
        ubicacion === null
          ? "Sincroniza la ruta primero para compartir tu ubicación"
          : ordenId === null
            ? "No queda ninguna parada por gestionar"
            : undefined
      }
    >
      <Navigation aria-hidden className="size-4" />
      Trayecto desde aquí
    </Button>
  );
}
