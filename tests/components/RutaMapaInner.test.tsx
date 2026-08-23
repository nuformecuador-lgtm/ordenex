// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Feature 265 (R43) — LA TERCERA SEÑAL, LA QUE NO ES UN TEXTO.
//
// El mensajero tiene tres avisos distintos y el diseño exige que sigan siendo tres (R43):
//
//   1. «el punto de partida es aproximado»  -> un `<p>`  (feature 92)
//   2. «el orden de las paradas es aproximado» -> un `Alert` (feature 265)
//   3. el DIBUJO no sigue calles -> una LÍNEA PUNTEADA en el mapa (feature 97)
//
// Las dos primeras son texto y `RepartoModule.test.tsx` las afirma sobre el DOM. La tercera
// NO es texto, y hasta hoy sólo se afirmaba a medio camino: aquel test comprueba que el
// trazado con `fuente: "local"` llega a las **props** de `RutaMapa`, y ahí se paraba. Quien
// convierte esas props en la línea punteada es ESTE componente, y `dashArray` aparecía en un
// único sitio de todo el repo (`RutaMapaInner.tsx`) SIN QUE NINGÚN TEST LO TOCARA — hallazgo
// **m3** de `progress/review_265.md`. Borrar `dashArray` dejaba la suite entera en verde y al
// mensajero con una línea recta continua que le dice «esto es un recorrido navegable» cuando
// no lo es. Es exactamente el fallo mudo que esta casa persigue: no rompe nada, sólo miente.
//
// Se prueba el INNER, no el wrapper: el wrapper lo carga con `next/dynamic({ ssr: false })`
// —Leaflet toca `window` en el ámbito del módulo— y quien decide el estilo de la línea es el
// inner. Molde del mock: `tests/components/UbicacionMapa.test.tsx`, que ya resolvió cómo
// montar un componente de react-leaflet en jsdom sin canvas.

// --- Mock de leaflet y react-leaflet (jsdom no pinta canvas ni tiene el `window` de Leaflet).
// `Polyline` es el único que importa aquí: expone sus `pathOptions` como JSON en un atributo
// para poder afirmarlas sobre el DOM renderizado y no sobre el objeto que le pasamos nosotros.
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet", () => ({
  default: { divIcon: (opts: unknown) => ({ opts }) },
}));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Polyline: ({ pathOptions }: { pathOptions?: Record<string, unknown> }) => (
    <div data-testid="polyline" data-path-options={JSON.stringify(pathOptions ?? {})} />
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
}));

import { RutaMapaInner } from "@/app/(app)/mis-asignaciones/_components/RutaMapaInner";
import { codificarPolilinea } from "@/lib/geo/polilinea";

afterEach(cleanup);

// Tres puntos reales (San José, CR): la polilínea se CODIFICA con la función del repo en vez
// de pegar una cadena mágica, porque el componente la DECODIFICA y una cadena inventada
// caería por la rama de «polilínea corrupta» sin que el test se enterara.
const POLILINEA = codificarPolilinea([
  { lat: 9.93, lng: -84.09 },
  { lat: 9.94, lng: -84.1 },
  { lat: 9.95, lng: -84.11 },
]);

const PARADAS = [
  { id: "o1", secuencia: 1, lat: 9.93, lng: -84.09, etiqueta: "REM-1 · Uno" },
  { id: "o2", secuencia: 2, lat: 9.95, lng: -84.11, etiqueta: "REM-2 · Dos" },
];

/** `pathOptions` de la línea de la RUTA (la primera `Polyline` montada). */
function opcionesDeLaRuta(container: HTMLElement): Record<string, unknown> {
  const linea = container.querySelectorAll('[data-testid="polyline"]')[0];
  expect(linea, "el mapa tiene que pintar la línea de la ruta").toBeDefined();
  return JSON.parse(linea!.getAttribute("data-path-options") ?? "{}") as Record<string, unknown>;
}

describe("265/R43 — la tercera señal: el trazado LOCAL se dibuja PUNTEADO", () => {
  it("`fuente: local` -> la línea lleva dashArray (no es un recorrido navegable)", () => {
    const { container } = render(
      <RutaMapaInner
        paradas={PARADAS}
        origen={{ lat: 9.92, lng: -84.08 }}
        trazado={{ encodedPolyline: POLILINEA, fuente: "local" }}
      />,
    );

    const opciones = opcionesDeLaRuta(container);
    // Mata la mutación «borrar el `dashArray`» y la mutación «invertir la condición».
    expect(
      opciones.dashArray,
      "un orden calculado en la app se dibuja punteado: pintarlo continuo le dice al " +
        "mensajero que la línea sigue calles, y no las sigue",
    ).toBe("8 8");
    expect(opciones.opacity).toBe(0.75);
  });

  it("`fuente: routes` -> la línea es CONTINUA (sí sigue calles)", () => {
    const { container } = render(
      <RutaMapaInner
        paradas={PARADAS}
        origen={{ lat: 9.92, lng: -84.08 }}
        trazado={{ encodedPolyline: POLILINEA, fuente: "routes" }}
      />,
    );

    const opciones = opcionesDeLaRuta(container);
    // La mitad negativa: sin ella, puntear SIEMPRE también pasaría el test de arriba, y
    // entonces la señal dejaría de distinguir nada.
    expect(opciones).not.toHaveProperty("dashArray");
    expect(opciones.opacity).toBeUndefined();
  });

  it("SIN trazado (paradas unidas en recto) la línea también va punteada", () => {
    // No hay geometría del proveedor, así que lo que se ve es el orden de visita, no un
    // recorrido. `esPorCalles` es falso y la línea tiene que salir punteada igual.
    const { container } = render(
      <RutaMapaInner paradas={PARADAS} origen={{ lat: 9.92, lng: -84.08 }} trazado={null} />,
    );

    expect(opcionesDeLaRuta(container).dashArray).toBe("8 8");
  });
});
