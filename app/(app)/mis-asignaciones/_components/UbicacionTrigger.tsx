"use client";

import { useState, type ReactNode } from "react";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { UbicacionModal } from "./UbicacionModal";
import type { UbicacionPunto } from "./ubicacion-mapa-tipos";
import { destinoDeOrden } from "./pos-card/pos-format";

// Pedido humano (rama ux): los controles de navegación del mensajero DEJAN de sacarlo de
// la app. En vez de abrir Google Maps en otra pestaña, abren el MISMO modal de minimapa
// que la ubicación compartida del chat (`UbicacionModal`, feature 121): el destino de la
// orden y su GPS actual en el mismo mapa, sin perder la pantalla en la que estaba.
//
// Envuelve el contenido visual de cada sitio (bloque "Ir", fila del mosaico, botón
// "Navegar" del panel), así que cada consumidor conserva sus propias clases.
//
// Feature 289 — dentro de ese modal ya se puede saltar a la app de navegación propia
// (Waze, Google Maps, Apple Maps, o el selector del sistema en Android). Eso cambia dos
// cosas aquí:
//  - El control es SIEMPRE un `<button>`. Antes, una orden sin coordenadas era un `<a>`
//    directo a Google Maps; ahora abre el mismo modal, sin mapa pero con el aviso y la
//    fila de apps, para que en ese caso el mensajero también pueda elegir con qué navegar.
//  - Se pasa `destino`, que es lo que habilita esa fila. El chat no lo pasa, y por eso su
//    modal de ubicación compartida sigue igual que antes.

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
        abierto={abierto}
        punto={abierto ? punto : null}
        onOpenChange={setAbierto}
        titulo="Ubicación de la orden"
        descripcion="El destino de la orden y tu ubicación actual."
        destino={destinoDeOrden(orden)}
      />
    </>
  );
}
