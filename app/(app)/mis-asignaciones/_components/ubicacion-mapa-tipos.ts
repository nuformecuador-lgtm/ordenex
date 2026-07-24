// Feature 121 — tipos compartidos del minimapa de ubicacion. Viven en su propio modulo (sin
// `"use client"` ni imports de `leaflet`) para que tanto el wrapper `UbicacionMapa` como el
// render pesado `UbicacionMapaInner` los importen sin arrastrar Leaflet a un modulo que no lo
// necesita (mismo patron que `ruta-mapa-tipos.ts` de la feature 97).

/** Un punto dibujable en el minimapa (coordenadas ya validadas). */
export interface UbicacionPunto {
  lat: number;
  lng: number;
}
