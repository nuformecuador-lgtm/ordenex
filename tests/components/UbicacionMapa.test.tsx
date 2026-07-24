// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Feature 121 F1.T (R14) — el minimapa de ubicación. Dos frentes:
//  1) El wrapper `UbicacionMapa` DEBE cargar el render pesado con `next/dynamic({ ssr:false })`
//     para que Leaflet nunca se ejecute en el servidor. Se mockea `next/dynamic` para capturar
//     sus opciones sin cargar realmente Leaflet.
//  2) El inner `UbicacionMapaInner` dibuja EXACTAMENTE 2 marcadores con 2 puntos y 1 con uno
//     solo. Se mockea `react-leaflet`/`leaflet` (jsdom no pinta canvas ni toca `window` de
//     Leaflet), afirmando el número de `Marker` montados.

// --- Mock de next/dynamic: captura las opciones y devuelve un stub que NO carga el inner. ---
const { dynamicOptionsMock } = vi.hoisted(() => ({ dynamicOptionsMock: vi.fn() }));
vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, options: unknown) => {
    dynamicOptionsMock(options);
    return function DynamicStub() {
      return <div data-testid="dynamic-inner" />;
    };
  },
}));

// --- Mock de leaflet y react-leaflet para el inner (sin canvas ni `window` de Leaflet). ---
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet", () => ({
  default: {
    divIcon: (opts: unknown) => ({ opts }),
  },
}));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
}));

import { UbicacionMapa } from "@/app/(app)/mis-asignaciones/_components/UbicacionMapa";
import { UbicacionMapaInner } from "@/app/(app)/mis-asignaciones/_components/UbicacionMapaInner";

afterEach(() => {
  cleanup();
  dynamicOptionsMock.mockClear();
});

describe("UbicacionMapa (wrapper)", () => {
  // R14
  it("carga el minimapa con next/dynamic ssr:false", () => {
    render(<UbicacionMapa cliente={{ lat: 9.9, lng: -84 }} repartidor={null} />);

    expect(screen.getByTestId("dynamic-inner")).toBeInTheDocument();
    expect(dynamicOptionsMock).toHaveBeenCalledTimes(1);
    const options = dynamicOptionsMock.mock.calls[0][0] as { ssr: boolean };
    expect(options.ssr).toBe(false);
  });
});

describe("UbicacionMapaInner", () => {
  // R14 (render) — 2 puntos => 2 marcadores.
  it("dibuja 2 marcadores con cliente y repartidor", () => {
    render(
      <UbicacionMapaInner
        cliente={{ lat: 9.9333, lng: -84.0833 }}
        repartidor={{ lat: 9.94, lng: -84.09 }}
      />,
    );
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
  });

  // R12 (base) — sin repartidor => 1 solo marcador (el del cliente).
  it("dibuja 1 marcador cuando no hay repartidor", () => {
    render(
      <UbicacionMapaInner
        cliente={{ lat: 9.9333, lng: -84.0833 }}
        repartidor={null}
      />,
    );
    expect(screen.getAllByTestId("marker")).toHaveLength(1);
  });
});
