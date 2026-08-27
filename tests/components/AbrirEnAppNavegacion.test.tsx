// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AbrirEnAppNavegacion } from "@/app/(app)/mis-asignaciones/_components/AbrirEnAppNavegacion";
import type { DestinoNavegacion } from "@/lib/utils/navegacion-externa";
import { CLAVE_APP_NAVEGACION } from "@/lib/utils/preferencia-navegacion";

// Feature 289 — la fila "Abrir en:" del modal de navegación del mensajero.

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120";
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const UA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120";

const DESTINO: DestinoNavegacion = {
  lat: 9.9333,
  lng: -84.0833,
  texto: "Av. Central 100, Carmen, San José",
};

/** `navigator` es de solo lectura en jsdom: se redefinen las dos propiedades que se leen. */
function fingirDispositivo(userAgent: string, maxTouchPoints: number): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
}

function nombresDeLosEnlaces(): string[] {
  return screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("aria-label") ?? "");
}

describe("AbrirEnAppNavegacion", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("que se ofrece en cada plataforma", () => {
    it("en Android ofrece el selector del sistema, Waze y Google Maps", () => {
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual([
        "Abrir en otra app de mapas",
        "Abrir en Waze",
        "Abrir en Google Maps",
      ]);
    });

    it("en iPhone ofrece Apple Maps, Google Maps y Waze, y NO el selector geo:", () => {
      // Safari ignora `geo:` en silencio: ofrecerlo sería un botón que no hace nada.
      fingirDispositivo(UA_IPHONE, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual([
        "Abrir en Apple Maps",
        "Abrir en Google Maps",
        "Abrir en Waze",
      ]);
      expect(
        screen.queryByRole("link", { name: "Abrir en otra app de mapas" }),
      ).toBeNull();
    });

    it("en escritorio ofrece solo Google Maps", () => {
      fingirDispositivo(UA_WINDOWS, 0);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual(["Abrir en Google Maps"]);
    });
  });

  describe("los enlaces", () => {
    it("apuntan a la app correcta con las coordenadas de la orden", () => {
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(
        screen.getByRole("link", { name: "Abrir en Waze" }),
      ).toHaveAttribute(
        "href",
        "https://waze.com/ul?ll=9.9333,-84.0833&navigate=yes",
      );
      expect(
        screen.getByRole("link", { name: "Abrir en Google Maps" }),
      ).toHaveAttribute(
        "href",
        "https://www.google.com/maps/dir/?api=1&destination=9.9333,-84.0833",
      );
      expect(
        screen.getByRole("link", { name: "Abrir en otra app de mapas" }),
      ).toHaveAttribute("href", expect.stringContaining("geo:9.9333,-84.0833"));
    });

    it("una orden sin coordenadas navega por su direccion escrita", () => {
      fingirDispositivo(UA_WINDOWS, 0);
      render(
        <AbrirEnAppNavegacion
          destino={{ lat: null, lng: null, texto: "Frente al parque, Escazú" }}
        />,
      );
      expect(
        screen.getByRole("link", { name: "Abrir en Google Maps" }),
      ).toHaveAttribute(
        "href",
        "https://www.google.com/maps/dir/?api=1&destination=Frente%20al%20parque%2C%20Escaz%C3%BA",
      );
    });

    it("los https: salen en pestana nueva con rel seguro", () => {
      fingirDispositivo(UA_IPHONE, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      for (const nombre of [
        "Abrir en Apple Maps",
        "Abrir en Google Maps",
        "Abrir en Waze",
      ]) {
        const enlace = screen.getByRole("link", { name: nombre });
        expect(enlace).toHaveAttribute("target", "_blank");
        expect(enlace).toHaveAttribute("rel", "noopener noreferrer");
      }
    });

    it("el geo: NO abre en pestana nueva: dejaria una pestana en blanco detras", () => {
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      const selector = screen.getByRole("link", {
        name: "Abrir en otra app de mapas",
      });
      expect(selector).not.toHaveAttribute("target");
      expect(selector).not.toHaveAttribute("rel");
    });
  });

  describe("la app elegida se recuerda en el dispositivo", () => {
    it("al usar una opcion se guarda cual fue", async () => {
      const user = userEvent.setup();
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      await user.click(screen.getByRole("link", { name: "Abrir en Waze" }));
      expect(window.localStorage.getItem(CLAVE_APP_NAVEGACION)).toBe("waze");
    });

    it("la guardada se ofrece primera la proxima vez", () => {
      window.localStorage.setItem(CLAVE_APP_NAVEGACION, "google");
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual([
        "Abrir en Google Maps",
        "Abrir en otra app de mapas",
        "Abrir en Waze",
      ]);
    });

    it("una preferida que no existe en esta plataforma se ignora en vez de colarse", () => {
      // El mensajero eligió Apple Maps en su iPad y luego abre la app en Android.
      window.localStorage.setItem(CLAVE_APP_NAVEGACION, "apple");
      fingirDispositivo(UA_ANDROID, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual([
        "Abrir en otra app de mapas",
        "Abrir en Waze",
        "Abrir en Google Maps",
      ]);
    });

    it("un valor corrupto en el almacenamiento no altera el orden", () => {
      window.localStorage.setItem(CLAVE_APP_NAVEGACION, "tomtom");
      fingirDispositivo(UA_IPHONE, 5);
      render(<AbrirEnAppNavegacion destino={DESTINO} />);
      expect(nombresDeLosEnlaces()).toEqual([
        "Abrir en Apple Maps",
        "Abrir en Google Maps",
        "Abrir en Waze",
      ]);
    });
  });

  it("la fila se anuncia con su rotulo", () => {
    fingirDispositivo(UA_ANDROID, 5);
    const { container } = render(<AbrirEnAppNavegacion destino={DESTINO} />);
    expect(within(container).getByText("Abrir en:")).toBeInTheDocument();
  });
});
