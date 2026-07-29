// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { serializarFiltro } from "@/app/(app)/ordenes/_components/serializar-filtro";

// Feature 144 / TB4.2 (R45, R60, R61) — identidad de caché y reset de paginación.

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

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
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

describe("serializarFiltro — key estable (R61)", () => {
  it("R61: dos filtros equivalentes en distinto ORDEN producen la MISMA key", () => {
    expect(serializarFiltro({ zona_id: ["z2", "z1"], status_id: ["e1"] })).toBe(
      serializarFiltro({ status_id: ["e1"], zona_id: ["z1", "z2"] }),
    );
  });

  it("R61: dos objetos distintos con los mismos valores producen la MISMA key", () => {
    const a = { provincia_id: ["p1"], created_preset: "30d" as const };
    const b = { created_preset: "30d" as const, provincia_id: ["p1"] };
    expect(serializarFiltro(a)).toBe(serializarFiltro(b));
  });

  it("R61: filtros DISTINTOS producen keys distintas", () => {
    expect(serializarFiltro({ zona_id: ["z1"] })).not.toBe(
      serializarFiltro({ zona_id: ["z2"] }),
    );
    expect(serializarFiltro({ zona_id: ["z1"] })).not.toBe(
      serializarFiltro({ zona_id: ["z1", "z2"] }),
    );
    expect(serializarFiltro({ created_desde: "2026-07-01" })).not.toBe(
      serializarFiltro({ created_hasta: "2026-07-01" }),
    );
  });

  it("R45: sin `filter`, la key es la cadena vacía (comportamiento previo)", () => {
    expect(serializarFiltro(undefined)).toBe("");
    expect(serializarFiltro({})).toBe("");
  });
});

describe("OrdenesModule — caché por filtro (R61)", () => {
  it("R61: re-renderizar con un filtro EQUIVALENTE no dispara una consulta nueva", async () => {
    const { rerender } = renderModule(
      <OrdenesModule filter={{ zona_id: ["z1", "z2"], status_id: ["e1"] }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <OrdenesModule filter={{ status_id: ["e1"], zona_id: ["z2", "z1"] }} />
        </ToastProvider>
      </SWRConfig>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);
  });

  it("R45: sin `filter`, la llamada a `listarOrdenes` es la previa a esta feature", async () => {
    renderModule(<OrdenesModule />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("los filtros nuevos viajan dentro del MISMO `filter` de `listarOrdenes`", async () => {
    renderModule(
      <OrdenesModule
        filter={{ zona_id: ["z1"], created_preset: "30d", status_id: ["e1"] }}
      />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      filter: { zona_id: ["z1"], created_preset: "30d", status_id: ["e1"] },
    });
  });
});

describe("OrdenesModule — reset ante el cambio de filtro (R60)", () => {
  it("R60: cambiar CUALQUIER filtro vuelve a la página 1", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(<OrdenesModule filter={{ zona_id: ["z1"] }} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <OrdenesModule filter={{ zona_id: ["z2"] }} />
        </ToastProvider>
      </SWRConfig>,
    );

    await waitFor(() => {
      const ultima = listarOrdenesMock.mock.calls.at(-1)?.[0] as {
        page: number;
        filter?: { zona_id?: string[] };
      };
      expect(ultima.page).toBe(1);
      expect(ultima.filter?.zona_id).toEqual(["z2"]);
    });
  });

  it("R60: cambiar el filtro limpia la selección de filas", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(
      <OrdenesModule filter={{ zona_id: ["z1"] }} selectable acciones={[]} />,
    );
    await screen.findByText("1001");

    await user.click(screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }));
    expect(
      screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
    ).toBeChecked();

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <OrdenesModule filter={{ zona_id: ["z2"] }} selectable acciones={[]} />
        </ToastProvider>
      </SWRConfig>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
      ).not.toBeChecked(),
    );
  });
});
