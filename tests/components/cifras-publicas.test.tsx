// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CifraAnimada,
  cifrasDeConteo,
  leerConteosPublicos,
} from "@/app/_landing/cifras-publicas";
import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";

// Feature 198 — las cifras publicas tal como las consumen el hero y la banda.
//
// Sustituye a `tests/components/LandingConteos.test.tsx`: el bloque propio desaparecio y estas
// cifras pasaron a vivir dentro del hero y de la banda. EL CASO QUE IMPORTA sigue siendo el
// mismo: que un fallo de la lectura NO tumbe la landing, que es la unica pantalla que ve
// alguien de fuera.

vi.mock("@/lib/actions/conteos-publicos", () => ({
  obtenerConteosPublicos: vi.fn(),
}));

const conteosMock = vi.mocked(obtenerConteosPublicos);

const CONTEOS = {
  distritosConCobertura: 128,
  ordenesGestionadas: 123,
  ordenesSinGestionar: 7,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("leerConteosPublicos", () => {
  it("NO BLOQUEANTE: si la lectura falla devuelve null y no propaga", async () => {
    // Base caida, migracion a medias, lo que sea: el visitante ve la landing entera, sin
    // cifras y sin error. `null` es lo que hace que las secciones omitan el hueco numerico.
    conteosMock.mockRejectedValue(new Error("base caida"));

    await expect(leerConteosPublicos()).resolves.toBeNull();
  });

  it("no le pasa ningun argumento a la accion", async () => {
    // La accion es publica y su firma vacia es la defensa contra convertirla en un oraculo
    // por inquilino. El consumidor tiene que respetarlo.
    conteosMock.mockResolvedValue(CONTEOS);

    await leerConteosPublicos();

    expect(conteosMock).toHaveBeenCalledWith();
  });
});

describe("cifrasDeConteo", () => {
  it("anuncia los tres conteos, en orden y con su redaccion", () => {
    expect(cifrasDeConteo(CONTEOS)).toEqual([
      { valor: 128, etiqueta: "Con cobertura" },
      { valor: 123, etiqueta: "Órdenes efectivas" },
      { valor: 7, etiqueta: "Usuarios que nos esperan" },
    ]);
  });

  it("ante un fallo devuelve lista vacia, NO ceros", () => {
    // Omitir es preferible a pintar «0 con cobertura», que dice algo falso en la portada. El
    // cero solo es legitimo como estado de carga, y ese lo pone el fallback de `<Suspense>`.
    expect(cifrasDeConteo(null)).toEqual([]);
  });
});

describe("CifraAnimada", () => {
  it("el HTML de SERVIDOR sale en 0: la animacion sube desde ahi, sin flash del valor final", () => {
    // `start=0` explicito en `KpiValorAnimado`. Se afirma sobre `renderToStaticMarkup` y no
    // sobre `render` a proposito: en jsdom el contador ya llega a su valor final dentro del
    // `act()` de Testing Library, asi que ahi el estado inicial es INOBSERVABLE. El sitio
    // donde este 0 importa de verdad es el HTML que se manda al navegador.
    expect(renderToStaticMarkup(<CifraAnimada valor={128} />)).toContain("+0");
  });

  it("anima hasta el valor APROXIMADO, no el exacto", async () => {
    // 128 reales se anuncian «+120». Si aqui apareciera «+128», la aproximacion se perdio por
    // el camino entre `aproximarADecenas` y el contador.
    render(<CifraAnimada valor={128} />);

    expect(await screen.findByText("+120", undefined, { timeout: 4000 })).toBeTruthy();
  });

  it("por debajo del umbral no inventa un `+`", async () => {
    render(<CifraAnimada valor={7} />);

    expect(await screen.findByText("7", undefined, { timeout: 4000 })).toBeTruthy();
  });
});
