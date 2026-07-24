"use client";

// Feature 121 (design §5.2, R10-R12) — render REAL del minimapa de una ubicacion compartida
// por el cliente, con Leaflet + tiles de OpenStreetMap. Este archivo importa `leaflet`, que
// toca `window`/`document` en el ambito del modulo, asi que NUNCA debe ejecutarse en el
// servidor: se carga SIEMPRE via `next/dynamic(..., { ssr: false })` desde `UbicacionMapa.tsx`,
// nunca de forma directa (R14).
//
// Se calca el andamiaje de `RutaMapaInner.tsx` (feature 97), pero con semantica distinta: aqui
// no hay ruta ni secuencia, solo DOS puntos sueltos y distinguibles: el compartido por el
// cliente y el GPS EN VIVO del repartidor (omitido si no se pudo capturar). Por eso son
// componentes separados (design §Decision 1: las APIs difieren, no se generaliza).
//
// GOTCHA de iconos (heredado de la 97): el icono PNG por defecto de Leaflet se rompe con los
// bundlers. En vez de re-parchear `L.Icon.Default`, se usa `L.divIcon` con HTML propio.
import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import L, { type LatLngTuple } from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";

import type { UbicacionPunto } from "./ubicacion-mapa-tipos";

// Atribucion obligatoria de OSM (condicion de uso de sus tiles publicos).
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Centro por defecto (Ecuador ~ Quito) para el caso degenerado; `AjustarEncuadre` re-encuadra
// en cuanto hay al menos un punto real.
const CENTRO_FALLBACK: LatLngTuple = [-0.1807, -78.4678];

/** Marcador del punto compartido por el cliente (destino). Pin naranja, distinguible. */
function iconoCliente(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);background:#f26419;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
}

/** Marcador del GPS EN VIVO del repartidor ("tu"), distinto del punto del cliente (R11). */
function iconoRepartidor(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Re-encuadra el mapa a los puntos disponibles: `fitBounds` con 2, `setView` con 1. */
function AjustarEncuadre({ puntos }: { puntos: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (puntos.length === 0) return;
    if (puntos.length === 1) {
      map.setView(puntos[0], 15);
      return;
    }
    map.fitBounds(puntos, { padding: [40, 40] });
  }, [map, puntos]);
  return null;
}

export interface UbicacionMapaInnerProps {
  /** Punto compartido por el cliente (siempre presente: es el motivo del minimapa). */
  cliente: UbicacionPunto;
  /** GPS EN VIVO del repartidor; `null` si no se pudo capturar (permiso/timeout, R12). */
  repartidor: UbicacionPunto | null;
}

export function UbicacionMapaInner({
  cliente,
  repartidor,
}: Readonly<UbicacionMapaInnerProps>) {
  const puntosEncuadre = useMemo<LatLngTuple[]>(() => {
    const base: LatLngTuple[] = [[cliente.lat, cliente.lng]];
    return repartidor ? [...base, [repartidor.lat, repartidor.lng]] : base;
  }, [cliente, repartidor]);

  return (
    <MapContainer
      center={[cliente.lat, cliente.lng]}
      zoom={15}
      scrollWheelZoom={false}
      className="h-72 w-full rounded-xl"
      // Leaflet pinta encima de otros elementos si no se acota su z-index.
      style={{ zIndex: 0 }}
    >
      <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />

      <Marker position={[cliente.lat, cliente.lng]} icon={iconoCliente()}>
        <Tooltip>Ubicación del cliente</Tooltip>
      </Marker>

      {/* Segundo marcador solo si hay GPS del repartidor (R11/R12). */}
      {repartidor ? (
        <Marker
          position={[repartidor.lat, repartidor.lng]}
          icon={iconoRepartidor()}
        >
          <Tooltip>Tu ubicación</Tooltip>
        </Marker>
      ) : null}

      <AjustarEncuadre puntos={puntosEncuadre} />
    </MapContainer>
  );
}
