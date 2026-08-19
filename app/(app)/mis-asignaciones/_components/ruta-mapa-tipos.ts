// Feature 97 — tipos compartidos del mapa de ruta. Viven en su propio módulo (sin `"use
// client"` ni imports de `leaflet`) para que tanto el wrapper `RutaMapa` como el render
// pesado `RutaMapaInner` los importen sin arrastrar Leaflet a un módulo que no lo necesita.

/** Una parada dibujable: ya filtrada a las que TIENEN coordenadas. */
export interface RutaMapaParada {
  id: string;
  /** Posición 1-based en la ruta optimizada; `null` = pendiente de optimizar (R28). */
  secuencia: number | null;
  lat: number;
  lng: number;
  /** Texto accesible del marcador (p. ej. `Nº remisión · destinatario`), sin PII sensible. */
  etiqueta: string;
}

/** Punto de partida del mensajero (última ubicación GPS conocida en el cliente). */
export interface RutaMapaOrigen {
  lat: number;
  lng: number;
}

/**
 * Trazado de la ruta devuelto por la sincronización (feature 92, seguimiento). Cuando llega,
 * el mapa dibuja ESTA geometría en vez de unir las paradas en recto.
 *
 *   `routes` — sigue las calles. Línea CONTINUA.
 *   `local`  — segmentos rectos entre paradas. Línea PUNTEADA: no es un recorrido navegable
 *              y pintarla igual que la real le mentiría al mensajero.
 */
export interface RutaMapaTrazado {
  encodedPolyline: string;
  fuente: "routes" | "local";
}
