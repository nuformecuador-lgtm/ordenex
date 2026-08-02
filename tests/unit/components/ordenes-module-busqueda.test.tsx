// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { serializarFiltro } from "@/app/(app)/ordenes/_components/serializar-filtro";

// Feature 169 / T3.4 + T3.5 (R38, R39, R40) — el termino dentro de la identidad de
// cache del listado, el reset de pagina/seleccion y el vacio CON busqueda.

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";

function makeOrden(id: string, numGuia: number): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-1",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as OrdenListItemDTO;
}

function envolver(ui: ReactElement) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>
  );
}

function renderModule(ui: ReactElement) {
  return render(envolver(ui));
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden("o1", 1001), makeOrden("o2", 1002)],
    page: 1,
    pageSize: 25,
    total: 60,
  });
});

afterEach(() => cleanup());

describe("serializarFiltro — el termino entra en la key de cache (R39)", () => {
  it("R39: el termino aparece en la key, como escalar", () => {
    expect(serializarFiltro({ q: "juan perez" })).toBe("q=juan perez");
  });

  it("R39: dos terminos DISTINTOS producen keys distintas (no comparten resultados)", () => {
    expect(serializarFiltro({ q: "juan" })).not.toBe(serializarFiltro({ q: "pedro" }));
  });

  it("R39: el MISMO termino produce la MISMA key (aunque cambie el orden del objeto)", () => {
    expect(serializarFiltro({ q: "juan", zona_id: ["z1"] })).toBe(
      serializarFiltro({ zona_id: ["z1"], q: "juan" }),
    );
  });

  it("R39: buscar NO es lo mismo que no buscar (la key cambia al aparecer el termino)", () => {
    expect(serializarFiltro({ zona_id: ["z1"] })).not.toBe(
      serializarFiltro({ zona_id: ["z1"], q: "juan" }),
    );
  });
});

describe("OrdenesModule — el termino viaja y no refetchea de mas (R39)", () => {
  it("el termino viaja dentro del MISMO `filter` de `listarOrdenes`", async () => {
    renderModule(<OrdenesModule filter={{ q: "juan", zona_id: ["z1"] }} />);

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      filter: { q: "juan", zona_id: ["z1"] },
    });
  });

  it("R39: re-renderizar con el MISMO termino no dispara una consulta nueva", async () => {
    const { rerender } = renderModule(<OrdenesModule filter={{ q: "juan" }} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));

    rerender(envolver(<OrdenesModule filter={{ q: "juan" }} />));

    await new Promise((r) => setTimeout(r, 50));
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);
  });

  it("R39: cambiar el termino SI dispara la consulta del termino nuevo", async () => {
    const { rerender } = renderModule(<OrdenesModule filter={{ q: "juan" }} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));

    rerender(envolver(<OrdenesModule filter={{ q: "pedro" }} />));

    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { q: "pedro" } }),
      ),
    );
  });
});

describe("OrdenesModule — reset ante el cambio de termino (R38)", () => {
  it("R38: cambiar el termino vuelve a la PAGINA 1", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(<OrdenesModule filter={{ q: "juan" }} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );

    rerender(envolver(<OrdenesModule filter={{ q: "pedro" }} />));

    await waitFor(() => {
      const ultima = listarOrdenesMock.mock.calls.at(-1)?.[0] as {
        page: number;
        filter?: { q?: string };
      };
      expect(ultima.page).toBe(1);
      expect(ultima.filter?.q).toBe("pedro");
    });
  });

  it("R38: cambiar el termino limpia la seleccion de filas", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(
      <OrdenesModule filter={{ q: "juan" }} selectable acciones={[]} />,
    );
    await screen.findByText("1001");

    await user.click(screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }));
    expect(
      screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
    ).toBeChecked();

    rerender(envolver(<OrdenesModule filter={{ q: "pedro" }} selectable acciones={[]} />));

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
      ).not.toBeChecked(),
    );
  });

  it("R38: vaciar la busqueda tambien vuelve a la pagina 1", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(<OrdenesModule filter={{ q: "juan" }} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );

    rerender(envolver(<OrdenesModule />));

    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 }),
    );
  });
});

describe("OrdenesModule — vacio CON busqueda activa (R40)", () => {
  beforeEach(() => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
  });

  it("R40: con termino y 0 resultados dice que no hay COINCIDENCIAS, no que no hay ordenes", async () => {
    renderModule(<OrdenesModule filter={{ q: "zzzz" }} />);

    expect(await screen.findByText("Sin coincidencias")).toBeInTheDocument();
    expect(screen.queryByText("No hay órdenes")).toBeNull();
  });

  it("R40: el mensaje repite el TERMINO buscado y ofrece limpiar la busqueda", async () => {
    renderModule(<OrdenesModule filter={{ q: "peñaa" }} />);

    const descripcion = await screen.findByText(/Ninguna orden coincide/);
    expect(descripcion).toHaveTextContent("peñaa");
    expect(descripcion).toHaveTextContent(/limpia la búsqueda/);
  });

  it("R40: SIN termino, el vacio sigue siendo el de siempre (sin regresion)", async () => {
    renderModule(<OrdenesModule filter={{ zona_id: ["z1"] }} />);

    expect(await screen.findByText("No hay órdenes")).toBeInTheDocument();
    expect(screen.queryByText("Sin coincidencias")).toBeNull();
  });

  it("R40: sin `filter` alguno, el vacio tampoco cambia", async () => {
    renderModule(<OrdenesModule />);

    expect(await screen.findByText("No hay órdenes")).toBeInTheDocument();
  });

  it("R40: con termino y resultados, no se pinta ningun vacio", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden("o1", 1001)],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderModule(<OrdenesModule filter={{ q: "juan" }} />);

    await screen.findByText("1001");
    expect(screen.queryByText("Sin coincidencias")).toBeNull();
    expect(screen.queryByText("No hay órdenes")).toBeNull();
  });
});
