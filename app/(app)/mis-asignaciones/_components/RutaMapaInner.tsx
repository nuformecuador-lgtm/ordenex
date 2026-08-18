"use client";

// Feature 97 (R28, design §10 relajado por el briefing) — render REAL del mapa de la ruta
// con Leaflet + tiles de OpenStreetMap. Este archivo importa `leaflet`, que toca `window`/
// `document` en el ámbito del módulo, así que NUNCA debe ejecutarse en el servidor: se carga
// SIEMPRE vía `next/dynamic(..., { ssr: false })` desde `RutaMapa.tsx`, nunca de forma directa.
//
// GOTCHA de iconos: el icono PNG por defecto de Leaflet se rompe con los bundlers (las rutas
// a los assets quedan mal resueltas). En vez de re-parchear `L.Icon.Default`, se usa
// `L.divIcon` con HTML propio: resuelve el bug Y da justo lo que pide R28 —marcadores
// NUMERADOS con la posición de la ruta (1, 2, 3…)—. El origen usa un `divIcon` distinto.
import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import L, { type LatLngTuple } from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

import { decodificarPolilinea } from "@/lib/geo/polilinea";

import type { RutaMapaParada, RutaMapaOrigen, RutaMapaTrazado } from "./ruta-mapa-tipos";

// Atribución obligatoria de OSM (condición de uso de sus tiles públicos).
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Centro por defecto (Ecuador ~ Quito) para el caso degenerado sin puntos; `FitBounds`
// re-encuadra en cuanto hay al menos un punto real.
const CENTRO_FALLBACK: LatLngTuple = [-0.1807, -78.4678];

/** Marcador numerado de una parada (R28): el número es su posición en la ruta. */
function iconoParada(numero: number | null): L.DivIcon {
  const texto = numero ?? "?";
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${texto}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Marcador del punto de partida del mensajero (distinto de las paradas). */
function iconoOrigen(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:#16a34a;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Re-encuadra el mapa a todos los puntos cada vez que cambian (paradas + origen). */
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

export interface RutaMapaInnerProps {
  /** Paradas CON coordenadas; las que no tengan coords se omiten antes de llegar aquí. */
  paradas: RutaMapaParada[];
  /** Punto de partida del mensajero (GPS), si se conoce. */
  origen?: RutaMapaOrigen | null;
  /**
   * Geometría de la ruta devuelta por la sincronización. Si viene de `routes`, sigue las
   * calles; si falta, se cae a unir las paradas en recto (comportamiento original).
   */
  trazado?: RutaMapaTrazado | null;
  /** Polilinea codificada del tramo a la SIGUIENTE parada, resaltado sobre el resto. */
  tramoSiguiente?: string | null;
}

export function RutaMapaInner({
  paradas,
  origen,
  trazado,
  tramoSiguiente,
}: RutaMapaInnerProps) {
  // La ruta (Polyline) conecta SOLO las paradas ya optimizadas, en orden de secuencia.
  // Las pendientes (sin secuencia) se muestran como marcador pero no entran a la línea:
  // todavía no tienen una posición real en el recorrido.
  const optimizadas = useMemo(
    () =>
      paradas
        .filter((p) => p.secuencia !== null)
        .sort((a, b) => (a.secuencia ?? 0) - (b.secuencia ?? 0)),
    [paradas],
  );

  // La línea que se pinta. Con `trazado` se usa su geometría —decenas o cientos de puntos
  // que siguen las calles si vino de Routes—; sin él se unen las paradas en recto, que es
  // como se dibujaba antes de la feature 92.
  const lineaRuta = useMemo<LatLngTuple[]>(() => {
    if (trazado !== null && trazado !== undefined && trazado.encodedPolyline !== "") {
      const puntos = decodificarPolilinea(trazado.encodedPolyline);
      // Una polilínea corrupta o vacía no debe dejar el mapa sin ruta: se cae al recto.
      if (puntos.length >= 2) return puntos.map<LatLngTuple>((p) => [p.lat, p.lng]);
    }
    const desdeOrigen: LatLngTuple[] = origen ? [[origen.lat, origen.lng]] : [];
    return [
      ...desdeOrigen,
      ...optimizadas.map<LatLngTuple>((p) => [p.lat, p.lng]),
    ];
  }, [optimizadas, origen, trazado]);

  // Punteada mientras la línea NO sea un recorrido real por calles: así el mensajero ve de
  // un vistazo si lo que tiene delante es navegable o solo el orden de visita.
  const esPorCalles = trazado?.fuente === "routes";

  // Tramo a la siguiente parada. Se dibuja ENCIMA del recorrido completo, en naranja: es lo
  // que el mensajero tiene delante ahora, y el resto de la ruta es contexto.
  const lineaTramo = useMemo<LatLngTuple[]>(() => {
    if (!tramoSiguiente) return [];
    const puntos = decodificarPolilinea(tramoSiguiente);
    // Un tramo de un solo punto no es una línea: se descarta en vez de pintar nada visible.
    return puntos.length >= 2 ? puntos.map<LatLngTuple>((p) => [p.lat, p.lng]) : [];
  }, [tramoSiguiente]);

  const puntosEncuadre = useMemo<LatLngTuple[]>(() => {
    const base = paradas.map<LatLngTuple>((p) => [p.lat, p.lng]);
    return origen ? [...base, [origen.lat, origen.lng]] : base;
  }, [paradas, origen]);

  return (
    <MapContainer
      center={puntosEncuadre[0] ?? CENTRO_FALLBACK}
      zoom={13}
      scrollWheelZoom={false}
      className="h-72 w-full rounded-xl"
      // Leaflet pinta encima de otros elementos si no se acota el z-index del panel.
      style={{ zIndex: 0 }}
    >
      <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />

      {lineaRuta.length >= 2 ? (
        <Polyline
          positions={lineaRuta}
          pathOptions={{
            color: "#2563eb",
            weight: 4,
            // El resto de la ruta se atenúa cuando hay un tramo destacado: si los dos se
            // pintaran igual de fuertes, resaltar no resaltaría nada.
            ...(lineaTramo.length >= 2 ? { opacity: 0.45 } : {}),
            ...(esPorCalles ? {} : { dashArray: "8 8", opacity: 0.75 }),
          }}
        />
      ) : null}

      {/* Tramo a la SIGUIENTE parada, encima del resto. Va después en el JSX a propósito:
          Leaflet apila por orden de montaje, así que este queda por encima de la línea
          completa sin tener que pelearse con z-index. */}
      {lineaTramo.length >= 2 ? (
        <Polyline
          positions={lineaTramo}
          pathOptions={{ color: "#f26419", weight: 6, opacity: 0.95 }}
        />
      ) : null}

      {origen ? (
        <Marker position={[origen.lat, origen.lng]} icon={iconoOrigen()}>
          <Tooltip>Tu ubicación de partida</Tooltip>
        </Marker>
      ) : null}

      {paradas.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={iconoParada(p.secuencia)}>
          <Tooltip>{p.etiqueta}</Tooltip>
        </Marker>
      ))}

      <AjustarEncuadre puntos={puntosEncuadre} />
    </MapContainer>
  );
}
