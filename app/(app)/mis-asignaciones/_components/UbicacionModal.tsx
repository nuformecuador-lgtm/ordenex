"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUbicacionActual, type Coords } from "@/hooks/useUbicacionActual";
import type { DestinoNavegacion } from "@/lib/utils/navegacion-externa";

import { AbrirEnAppNavegacion } from "./AbrirEnAppNavegacion";
import { UbicacionMapa } from "./UbicacionMapa";
import type { UbicacionPunto } from "./ubicacion-mapa-tipos";

// Feature 121 (R10-R13) — modal con el minimapa de un punto + el GPS EN VIVO del
// repartidor. Nació dentro del chat (burbuja de ubicación compartida) y se extrajo
// aquí para reutilizarlo desde la card del mensajero (pin de la orden) sin duplicar
// ni el Dialog ni la captura de GPS. El minimapa (Leaflet) se monta vía
// `next/dynamic({ ssr:false })` dentro de `UbicacionMapa` (R14).

export interface UbicacionModalProps {
  /** Punto a mostrar; `null` = modal cerrado. */
  punto: UbicacionPunto | null;
  /** Cierre del Dialog (`false`). Nunca recarga nada (R13). */
  onOpenChange: (abierto: boolean) => void;
  titulo?: string;
  descripcion?: string;
  /**
   * Feature 289 — destino para la fila "Abrir en:" (Waze / Maps / selector del sistema).
   * OPT-IN: sin esta prop el modal se comporta exactamente como antes, que es lo que quiere
   * el chat (feature 121), donde el punto es de un cliente y no un destino de reparto.
   */
  destino?: DestinoNavegacion;
  /**
   * Feature 289 — apertura explícita, para poder abrir el modal SIN punto que pintar (orden
   * aún no geocodificada). Sin ella manda `punto !== null`, el contrato original.
   */
  abierto?: boolean;
}

export function UbicacionModal({
  punto,
  onOpenChange,
  titulo = "Ubicación compartida",
  descripcion = "El punto compartido por el cliente y tu ubicación actual.",
  destino,
  abierto,
}: Readonly<UbicacionModalProps>) {
  // El GPS del repartidor se pide LAZY al abrir (P3), nunca al montar. La captura se
  // guarda JUNTO a las coordenadas que la originaron: así el resultado de una apertura
  // anterior no se cuela en la siguiente y no hace falta resetear estado en el efecto.
  // Se comparan lat/lng (primitivos) y no la identidad del objeto `punto`: quien monta
  // el modal puede construirlo en cada render sin disparar capturas en bucle.
  const { pedirUbicacion, denegado } = useUbicacionActual();
  const [captura, setCaptura] = useState<{
    lat: number;
    lng: number;
    coords: Coords | null;
  } | null>(null);

  const lat = punto?.lat ?? null;
  const lng = punto?.lng ?? null;

  useEffect(() => {
    if (lat === null || lng === null) return;
    let vigente = true;
    // `pedirUbicacion` nunca lanza: resuelve `Coords` o `null` (R12).
    void pedirUbicacion().then((coords) => {
      if (vigente) setCaptura({ lat, lng, coords });
    });
    return () => {
      vigente = false;
    };
  }, [lat, lng, pedirUbicacion]);

  // `gpsPedido` distingue "aún capturando" de "ya se intentó y falló" (R12).
  const gpsPedido =
    captura !== null && captura.lat === lat && captura.lng === lng;
  const gpsRepartidor = gpsPedido ? captura.coords : null;

  return (
    <Dialog open={abierto ?? punto !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        {punto ? (
          <UbicacionMapa cliente={punto} repartidor={gpsRepartidor} />
        ) : null}
        {/* Feature 289: una orden sin geocodificar no tiene punto que pintar, pero SÍ tiene
            dirección escrita, que es con lo que Waze o Maps la van a resolver. Se avisa en vez
            de dejar el modal vacío. */}
        {punto === null && destino ? (
          <p className="text-sm text-muted-foreground">
            Esta orden todavía no tiene ubicación exacta en el mapa. Se navegará
            por la dirección: {destino.texto || "sin dirección registrada"}.
          </p>
        ) : null}
        {/* R12: sin GPS del repartidor (denegado/timeout) el mapa pinta solo el punto
            del cliente y se avisa, sin bloquear apertura ni cierre. */}
        {gpsPedido && gpsRepartidor === null ? (
          <p role="status" className="text-xs text-muted-foreground">
            {denegado
              ? "No se pudo obtener tu ubicación actual: el permiso de ubicación está denegado."
              : "No se pudo obtener tu ubicación actual."}
          </p>
        ) : null}
        {destino ? <AbrirEnAppNavegacion destino={destino} /> : null}
      </DialogContent>
    </Dialog>
  );
}
