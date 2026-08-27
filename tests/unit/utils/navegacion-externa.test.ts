import { describe, it, expect } from "vitest";

import {
  abreEnPestanaNueva,
  appsPara,
  detectarPlataforma,
  urlNavegacion,
  type DestinoNavegacion,
} from "@/lib/utils/navegacion-externa";

// Feature 289 — el módulo puro de URLs de navegación. Es el único sitio del repo donde se
// escribe una URL de mapas, así que aquí se fija carácter a carácter qué se emite.

const CON_COORDS: DestinoNavegacion = {
  lat: 9.9333,
  lng: -84.0833,
  texto: "Av. Central 100, Carmen, San José, San José",
};

const SIN_COORDS: DestinoNavegacion = {
  lat: null,
  lng: null,
  texto: "Av. Central 100, Carmen, San José, San José",
};

const TEXTO_ESCAPADO =
  "Av.%20Central%20100%2C%20Carmen%2C%20San%20Jos%C3%A9%2C%20San%20Jos%C3%A9";

describe("detectarPlataforma", () => {
  it("reconoce Android por su user agent", () => {
    expect(
      detectarPlataforma(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120",
        5,
      ),
    ).toBe("android");
  });

  it("reconoce el iPhone por su user agent", () => {
    expect(
      detectarPlataforma(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        5,
      ),
    ).toBe("ios");
  });

  it("reconoce el iPad moderno, que se anuncia como Macintosh, por su pantalla tactil", () => {
    // Desde iPadOS 13 el UA de Safari es idéntico al de un Mac: `maxTouchPoints` es lo único
    // que los separa. Sin esta rama, un iPad se quedaría solo con Google Maps.
    expect(
      detectarPlataforma(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        5,
      ),
    ).toBe("ios");
  });

  it("un Mac de escritorio (mismo user agent, sin tactil) NO es ios", () => {
    expect(
      detectarPlataforma(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
        0,
      ),
    ).toBe("escritorio");
  });

  it("Windows es escritorio", () => {
    expect(
      detectarPlataforma(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        0,
      ),
    ).toBe("escritorio");
  });

  it("un user agent vacio cae a escritorio, la opcion que funciona en todas partes", () => {
    expect(detectarPlataforma("", 0)).toBe("escritorio");
  });
});

describe("appsPara", () => {
  it("en Android el selector del sistema va primero, seguido de Waze y Google Maps", () => {
    expect(appsPara("android")).toEqual(["sistema", "waze", "google"]);
  });

  it("en iOS ofrece Apple Maps, Google Maps y Waze", () => {
    expect(appsPara("ios")).toEqual(["apple", "google", "waze"]);
  });

  it("en escritorio ofrece solo Google Maps", () => {
    expect(appsPara("escritorio")).toEqual(["google"]);
  });

  it("el selector geo: NO se ofrece fuera de Android: iOS y el escritorio lo ignoran", () => {
    expect(appsPara("ios")).not.toContain("sistema");
    expect(appsPara("escritorio")).not.toContain("sistema");
  });

  it("Apple Maps NO se ofrece fuera del ecosistema Apple", () => {
    expect(appsPara("android")).not.toContain("apple");
    expect(appsPara("escritorio")).not.toContain("apple");
  });

  it("Google Maps esta disponible en las tres plataformas", () => {
    expect(appsPara("android")).toContain("google");
    expect(appsPara("ios")).toContain("google");
    expect(appsPara("escritorio")).toContain("google");
  });
});

describe("urlNavegacion con coordenadas", () => {
  it("Waze usa su enlace universal con navegacion ya activada", () => {
    // `waze.com/ul` y no `waze://`: el esquema nativo hacia una app no instalada no hace nada
    // y no hay forma de detectarlo; el universal abre la web.
    expect(urlNavegacion("waze", CON_COORDS)).toBe(
      "https://waze.com/ul?ll=9.9333,-84.0833&navigate=yes",
    );
  });

  it("Google Maps conserva exactamente el formato que ya se usaba", () => {
    expect(urlNavegacion("google", CON_COORDS)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=9.9333,-84.0833",
    );
  });

  it("Apple Maps pide indicaciones en coche", () => {
    expect(urlNavegacion("apple", CON_COORDS)).toBe(
      "https://maps.apple.com/?daddr=9.9333,-84.0833&dirflg=d",
    );
  });

  it("el selector del sistema emite geo: con la direccion como etiqueta del pin", () => {
    expect(urlNavegacion("sistema", CON_COORDS)).toBe(
      `geo:9.9333,-84.0833?q=9.9333,-84.0833(${TEXTO_ESCAPADO})`,
    );
  });
});

describe("urlNavegacion sin coordenadas (orden aun no geocodificada)", () => {
  it("Waze busca por texto", () => {
    expect(urlNavegacion("waze", SIN_COORDS)).toBe(
      `https://waze.com/ul?q=${TEXTO_ESCAPADO}&navigate=yes`,
    );
  });

  it("Google Maps busca por texto", () => {
    expect(urlNavegacion("google", SIN_COORDS)).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${TEXTO_ESCAPADO}`,
    );
  });

  it("Apple Maps busca por texto", () => {
    expect(urlNavegacion("apple", SIN_COORDS)).toBe(
      `https://maps.apple.com/?daddr=${TEXTO_ESCAPADO}&dirflg=d`,
    );
  });

  it("el selector del sistema usa geo:0,0, la forma documentada de buscar por texto", () => {
    expect(urlNavegacion("sistema", SIN_COORDS)).toBe(
      `geo:0,0?q=${TEXTO_ESCAPADO}`,
    );
  });

  it("escapa los caracteres que romperian la query", () => {
    const raro: DestinoNavegacion = {
      lat: null,
      lng: null,
      texto: "Casa #3 & anexo, 100m sur",
    };
    for (const url of [
      urlNavegacion("google", raro),
      urlNavegacion("waze", raro),
      urlNavegacion("apple", raro),
    ]) {
      expect(url).toContain("Casa%20%233%20%26%20anexo%2C%20100m%20sur");
      // El `#` sin escapar cortaría la URL en un fragmento y el `&` inventaría un parámetro.
      expect(url).not.toContain("#3");
    }
  });

  it("una orden sin direccion escrita produce una URL valida, no una excepcion", () => {
    const vacio: DestinoNavegacion = { lat: null, lng: null, texto: "" };
    expect(urlNavegacion("google", vacio)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=",
    );
  });
});

describe("abreEnPestanaNueva", () => {
  it("los enlaces https: abren en pestana nueva", () => {
    expect(abreEnPestanaNueva("waze")).toBe(true);
    expect(abreEnPestanaNueva("google")).toBe(true);
    expect(abreEnPestanaNueva("apple")).toBe(true);
  });

  it("el geo: NO abre en pestana nueva: lo atiende el sistema y dejaria una pestana vacia", () => {
    expect(abreEnPestanaNueva("sistema")).toBe(false);
  });
});
