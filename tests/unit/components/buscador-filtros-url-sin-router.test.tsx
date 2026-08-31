// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Feature 339 / T3.1 (R24) — la barra bajo un mock PARCIAL de `next/navigation`.
//
// Vive en un archivo aparte porque `vi.mock` es por archivo y este caso necesita
// justamente lo contrario que el otro: un modulo simulado que NO exporte
// `useSearchParams` ni `usePathname`. No es una rareza inventada para el test; es como
// mockean `next/navigation` media docena de tests ya escritos del repo
// (`tests/unit/components/ordenes-listado-buscador.test.tsx:18`,
// `tests/components/descarga/SateliteDescarga.test.tsx:58`, los dos de `paginacion/`).
// Ahi esos hooks valen `undefined` y llamarlos revienta: la barra tiene que montar igual
// y comportarse como si la URL viniera vacia.

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
}));

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";

afterEach(() => {
  cleanup();
});

describe("BuscadorFiltros — sin fuente de query params (R24)", () => {
  it("R24 — con `next/navigation` mockeado a medias monta sin lanzar y se ve la URL vacia", () => {
    const onChange = vi.fn();
    const onActivosChange = vi.fn();

    expect(() =>
      render(
        <BuscadorFiltros
          onChange={onChange}
          filtros={[{ key: "mensajero_id", label: "Mensajero" }]}
          activos={[]}
          onActivosChange={onActivosChange}
          onLimpiarTodo={vi.fn()}
          hayFiltrosAplicados
        />,
      ),
    ).not.toThrow();

    const campo = screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement;
    expect(campo.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    expect(onActivosChange).not.toHaveBeenCalled();

    // Y «Limpiar todo» no intenta navegar a ninguna parte: sin ruta no hay a donde.
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
