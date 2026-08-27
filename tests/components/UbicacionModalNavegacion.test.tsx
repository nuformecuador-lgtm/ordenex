// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

// Leaflet no monta en jsdom y aquí no se prueba el mapa, sino qué ofrece el modal.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => <div data-testid="minimapa" />,
}));

import { UbicacionModal } from "@/app/(app)/mis-asignaciones/_components/UbicacionModal";

// Pedido humano 2026-08-27 — el mapa que abre "Navegar" en el detalle del mensajero y el que
// abre la ubicación compartida por el chat son EL MISMO componente, y desde ahora ofrecen lo
// mismo: la fila "Abrir en:" con la app de mapas propia del mensajero.
//
// Antes esa fila era opt-in (`destino`) y el chat no la pasaba, así que la ubicación que el
// cliente compartía se podía mirar pero no navegar. Lo que este archivo protege es que la
// paridad no dependa de que cada consumidor se acuerde de pasar una prop: sin `destino`, el
// modal lo deriva del punto que está pintando.

const PUNTO = { lat: 9.9333, lng: -84.0833 };

describe("UbicacionModal · fila de apps de navegación", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: 5,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("sin `destino` (como lo monta el chat) ofrece las apps hacia el punto compartido", async () => {
    render(<UbicacionModal punto={PUNTO} onOpenChange={() => {}} />);

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByTestId("minimapa")).toBeInTheDocument();
    expect(within(dialogo).getByText("Abrir en:")).toBeInTheDocument();
    expect(
      within(dialogo).getByRole("link", { name: "Abrir en Waze" }),
    ).toHaveAttribute(
      "href",
      "https://waze.com/ul?ll=9.9333,-84.0833&navigate=yes",
    );
  });

  it("el selector del sistema rotula el pin con el título del modal", async () => {
    render(
      <UbicacionModal
        punto={PUNTO}
        onOpenChange={() => {}}
        titulo="Ubicación compartida"
      />,
    );

    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("link", { name: "Abrir en otra app de mapas" }),
    ).toHaveAttribute(
      "href",
      "geo:9.9333,-84.0833?q=9.9333,-84.0833(Ubicaci%C3%B3n%20compartida)",
    );
  });

  it("con `destino` explícito manda la dirección de la orden, no el punto", async () => {
    render(
      <UbicacionModal
        punto={PUNTO}
        onOpenChange={() => {}}
        destino={{ lat: null, lng: null, texto: "Frente al parque" }}
        abierto
      />,
    );

    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("link", { name: "Abrir en Waze" }),
    ).toHaveAttribute("href", expect.stringContaining("Frente%20al%20parque"));
  });

  it("sin punto y sin destino no hay a dónde ir: la fila no se pinta", () => {
    render(<UbicacionModal punto={null} onOpenChange={() => {}} abierto />);

    expect(screen.queryByText("Abrir en:")).toBeNull();
  });
});
