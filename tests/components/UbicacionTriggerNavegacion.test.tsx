// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Leaflet no monta en jsdom y aquí no se prueba el mapa, sino qué abre el control.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => <div data-testid="minimapa" />,
}));

import { UbicacionTrigger } from "@/app/(app)/mis-asignaciones/_components/UbicacionTrigger";

// Feature 289 — lo que protege este archivo:
//
//  - Que el botón "Navegar" siga abriendo el minimapa INTERNO y no saque de la app por su
//    cuenta (decisión firmada en la rama ux). Salir es un segundo gesto, deliberado.
//  - Que una orden SIN coordenadas también pueda elegir app. Antes ese caso era un enlace
//    directo a Google Maps: no había minimapa que abrir, pero tampoco elección posible.

function orden(overrides: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "orden-1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Av. Central 100",
    producto: "Caja",
    peso: 1,
    montoCobrar: 100,
    latitud: 9.9333,
    longitud: -84.0833,
    notas: null,
    tiendaNombre: "Tienda X",
    provinciaNombre: "San José",
    cantonNombre: "San José",
    distritoNombre: "Carmen",
    zonaNombre: "GAM",
    secuenciaRuta: null,
    ...overrides,
  } as MiAsignacionDTO;
}

function renderTrigger(datos: MiAsignacionDTO) {
  return render(
    <UbicacionTrigger orden={datos} ariaLabel="Ver en el mapa la ruta hasta Ana Pérez">
      Navegar
    </UbicacionTrigger>,
  );
}

describe("UbicacionTrigger", () => {
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

  it("el control es un boton, no un enlace: tocarlo no saca de la app", () => {
    renderTrigger(orden());
    expect(
      screen.getByRole("button", { name: /Ver en el mapa la ruta hasta Ana Pérez/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("una orden SIN coordenadas tampoco es un enlace directo a Maps", () => {
    // Este era el comportamiento anterior; se retira para que ahí también se pueda elegir app.
    renderTrigger(orden({ latitud: null, longitud: null }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Ver en el mapa la ruta hasta Ana Pérez/ }),
    ).toBeInTheDocument();
  });

  it("con coordenadas abre el minimapa interno y ademas ofrece las apps de navegacion", async () => {
    const user = userEvent.setup();
    renderTrigger(orden());
    await user.click(screen.getByRole("button", { name: /Ver en el mapa/ }));

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

  it("sin coordenadas abre el modal sin mapa, avisa y deja elegir app por la direccion", async () => {
    const user = userEvent.setup();
    renderTrigger(
      orden({ latitud: null, longitud: null, direccion: "Frente al parque" }),
    );
    await user.click(screen.getByRole("button", { name: /Ver en el mapa/ }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByTestId("minimapa")).toBeNull();
    expect(
      within(dialogo).getByText(/todavía no tiene ubicación exacta/),
    ).toBeInTheDocument();
    // La dirección escrita es justamente con lo que la app externa va a resolver.
    expect(
      within(dialogo).getByRole("link", { name: "Abrir en Waze" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("Frente%20al%20parque"),
    );
  });

  it("el modal arranca cerrado: nada se abre ni se pide GPS al montar la card", () => {
    renderTrigger(orden());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
