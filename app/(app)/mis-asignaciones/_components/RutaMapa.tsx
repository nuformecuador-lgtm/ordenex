"use client";

// Feature 97 (R28) — wrapper del mapa de ruta. Su ÚNICA responsabilidad es aislar el SSR:
// carga `RutaMapaInner` (que importa `leaflet` y toca `window`/`document`) con
// `next/dynamic({ ssr: false })`, de modo que Leaflet NUNCA se ejecute en el servidor.
//
// Por qué el wrapper y no el `dynamic` directo en el módulo del mensajero: mantener el
// `next/dynamic` aquí deja a `RutaMapaInner` como un módulo de cliente puro y permite que los
// tests del módulo mockeen `./RutaMapa` sin tocar Leaflet ni `next/dynamic` (jsdom no pinta
// canvas). `RutaMapa` es un componente de cliente (`"use client"`), condición necesaria para
// poder usar `{ ssr: false }`.
import dynamic from "next/dynamic";

import type { RutaMapaParada, RutaMapaOrigen, RutaMapaTrazado } from "./ruta-mapa-tipos";

const RutaMapaInner = dynamic(
  () => import("./RutaMapaInner").then((m) => m.RutaMapaInner),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-72 w-full items-center justify-center rounded-xl border border-dashed bg-muted/30 text-sm text-muted-foreground"
      >
        Cargando mapa…
      </div>
    ),
  },
);

export interface RutaMapaProps {
  paradas: RutaMapaParada[];
  origen?: RutaMapaOrigen | null;
  /** Geometría de la ruta devuelta por la sincronización (feature 92). */
  trazado?: RutaMapaTrazado | null;
}

export function RutaMapa({ paradas, origen, trazado }: RutaMapaProps) {
  return <RutaMapaInner paradas={paradas} origen={origen} trazado={trazado} />;
}
