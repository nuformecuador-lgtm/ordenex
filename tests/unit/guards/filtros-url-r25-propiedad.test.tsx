// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";

// Feature 339 / R25 — GUARDIA DE PROPIEDAD. ESTA ES **LA MITAD DE COMPORTAMIENTO**.
//
// R25 SE VIGILA CON DOS ARCHIVOS, Y ESTAN SEPARADOS A PROPOSITO
// -------------------------------------------------------------
// La otra mitad —la de LINTER, que invoca ESLint con la config real del repo sobre los tres
// archivos de la ficha— vive en `tests/unit/guards/filtros-url-r25.test.ts`. Las dos juntas
// son R25: aquella vigila la FORMA («no hay un setter de estado llamado desde un efecto»),
// esta vigila lo que la forma protege («la URL se lee UNA vez, al entrar»), que es una
// propiedad que el linter no puede ver. La ficha llego a tener un efecto que llamaba a una
// funcion auxiliar que por dentro hace `setSeleccion`, con valores leidos de una ref viva:
// el lint pasaba y la propiedad estaba rota (bloqueante B2). De ahi este archivo.
//
// NO LAS VUELVAS A FUSIONAR EN UN SOLO ARCHIVO. Estuvieron fusionadas y salio caro: este
// caso obliga a `// @vitest-environment jsdom`, y con las dos mitades juntas el arranque de
// ESLint pasaba a correr DENTRO de jsdom. Medido por el revisor: tardaba entre ~25 s y
// **mas de 113 s aislado, sin nada compitiendo**, y cruzaba su `hookTimeout` de 60 s en ~2
// de cada 5 corridas. Al expirar un `beforeAll` sus casos quedan **SKIPPED**, asi que la
// mitad de linter de R25 dejaba de verificar nada mientras el archivo aun podia verse
// verde. Aqui dentro solo debe vivir lo que necesita un DOM.

const replaceMock = vi.fn();

/** La URL de la prueba. `let` porque el caso la MUTA a mitad de vida del componente. */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fantasia",
  useSearchParams: () => parametros,
}));

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

beforeEach(() => {
  replaceMock.mockClear();
  parametros = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe("Feature 339 / R25 — la lectura de la URL ocurre UNA vez, al entrar (propiedad, no forma)", () => {
  it("R25 — mutar los query params tras el montaje no entra por la siembra: gana la foto de entrada", async () => {
    // Se entra con `?color=rojo` y el filtro declarado SIN catalogo: su valor se descarta
    // por R14 y la clave queda pendiente de sembrar. Mientras tanto la URL cambia a `azul`
    // —lo hace el tablero de `/analitica` y el detalle de `cierres-admin`, que reescriben la
    // query durante la sesion— y despues llega el catalogo, que es el disparador de la
    // siembra pendiente. Lo que se siembra debe ser `rojo`: lo que la URL traia AL ENTRAR.
    parametros = new URLSearchParams("color=rojo");
    const onChange = vi.fn();

    const vista = render(
      createElement(FilterComponent, {
        filters: [{ ...COLOR, options: [] }],
        onChange,
        debounceMs: 0,
      }),
    );

    parametros = new URLSearchParams("color=azul");
    vista.rerender(
      createElement(FilterComponent, { filters: [COLOR], onChange, debounceMs: 0 }),
    );

    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ color: ["rojo"] }),
    );
    expect(onChange.mock.calls.map(([sel]) => sel as FilterSelection)).not.toContainEqual({
      color: ["azul"],
    });
    expect(screen.getByRole("button", { name: /^Color:/ })).toHaveTextContent("Rojo");
  });
});
