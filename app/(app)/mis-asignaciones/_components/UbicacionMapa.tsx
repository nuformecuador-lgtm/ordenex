"use client";

// Feature 121 (R14) — wrapper del minimapa de ubicacion. Su UNICA responsabilidad es aislar el
// SSR: carga `UbicacionMapaInner` (que importa `leaflet` y toca `window`/`document`) con
// `next/dynamic({ ssr: false })`, de modo que Leaflet NUNCA se ejecute en el servidor.
//
// Igual que en la feature 97 (`RutaMapa.tsx`): dejar el `next/dynamic` aqui deja a
// `UbicacionMapaInner` como un modulo de cliente puro y permite que los tests del panel mockeen
// `./UbicacionMapa` sin arrastrar Leaflet a jsdom (que no pinta canvas). Es un componente de
// cliente (`"use client"`), condicion necesaria para poder usar `{ ssr: false }`.
import dynamic from "next/dynamic";

import type { UbicacionPunto } from "./ubicacion-mapa-tipos";

const UbicacionMapaInner = dynamic(
  () => import("./UbicacionMapaInner").then((m) => m.UbicacionMapaInner),
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

export interface UbicacionMapaProps {
  /** Punto compartido por el cliente (obligatorio). */
  cliente: UbicacionPunto;
  /** GPS EN VIVO del repartidor; `null` si no se pudo capturar (R12). */
  repartidor: UbicacionPunto | null;
}

export function UbicacionMapa({ cliente, repartidor }: Readonly<UbicacionMapaProps>) {
  return <UbicacionMapaInner cliente={cliente} repartidor={repartidor} />;
}
