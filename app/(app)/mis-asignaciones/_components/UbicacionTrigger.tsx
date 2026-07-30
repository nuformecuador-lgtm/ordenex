"use client";

import { useState, type ReactNode } from "react";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { UbicacionModal } from "./UbicacionModal";
import type { UbicacionPunto } from "./ubicacion-mapa-tipos";
import { mapsNavUrl } from "./pos-card/pos-format";

// Pedido humano (rama ux): los controles de navegación del mensajero DEJAN de sacarlo de
// la app. En vez de abrir Google Maps en otra pestaña, abren el MISMO modal de minimapa
// que la ubicación compartida del chat (`UbicacionModal`, feature 121): el destino de la
// orden y su GPS actual en el mismo mapa, sin perder la pantalla en la que estaba.
//
// Envuelve el contenido visual de cada sitio (bloque "Ir", fila del mosaico, botón
// "Navegar" del panel), así que cada consumidor conserva sus propias clases.
//
// FALLBACK: una orden SIN coordenadas geocodificadas (feature 91) no tiene punto que
// pintar; ahí se conserva el enlace a Maps, que resuelve por texto (dirección + zona).
// Así ninguna orden se queda sin forma de navegar.

export interface UbicacionTriggerProps {
  orden: MiAsignacionDTO;
  /** Nombre accesible del control (el contenido suele ser solo iconos/texto corto). */
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}

/** Coordenadas de la orden, o `null` si la orden no está geolocalizada. */
export function puntoDeOrden(orden: MiAsignacionDTO): UbicacionPunto | null {
  return orden.latitud !== null && orden.longitud !== null
    ? { lat: orden.latitud, lng: orden.longitud }
    : null;
}

export function UbicacionTrigger({
  orden,
  ariaLabel,
  className,
  children,
}: Readonly<UbicacionTriggerProps>) {
  const punto = puntoDeOrden(orden);
  const [abierto, setAbierto] = useState(false);

  // Sin coordenadas no hay minimapa que abrir: se mantiene la salida a Maps por texto.
  if (punto === null) {
    return (
      <a
        href={mapsNavUrl(orden)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </button>
      {/* El GPS del mensajero se pide LAZY al abrir (nunca al montar) dentro del modal. */}
      <UbicacionModal
        punto={abierto ? punto : null}
        onOpenChange={setAbierto}
        titulo="Ubicación de la orden"
        descripcion="El destino de la orden y tu ubicación actual."
      />
    </>
  );
}
