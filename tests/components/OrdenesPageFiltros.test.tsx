// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { RolValue } from "@prisma/client";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";

// Feature 144 / TB2.5 (R47, R64) — la PAGE resuelve el catálogo server-side y lo
// baja por props; si no se puede resolver, pasa `null` y la página sigue viva.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(),
}));

vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const resolveActorMock = vi.mocked(resolveActorFromSession);
const catalogoMock = vi.mocked(obtenerCatalogoFiltrosOrdenes);

const CATALOGO = {
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Central", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "Carmen", padreId: "c1" }],
};

async function renderPage() {
  const ui = (
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {await OrdenesPage()}
      </SWRConfig>
    </ToastProvider>
  );
  render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActorMock.mockResolvedValue({
    usuarioId: "u1",
    rol: RolValue.admin,
  });
  catalogoMock.mockResolvedValue({ status: "ok", catalogo: CATALOGO });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
});

afterEach(() => cleanup());

describe("OrdenesPage — catálogo de filtros (R47)", () => {
  it("R47: el catálogo se resuelve EN EL SERVIDOR, en UNA sola llamada al cargar la página", async () => {
    await renderPage();

    expect(catalogoMock).toHaveBeenCalledTimes(1);
    // Los filtros quedan operativos con las opciones ya presentes (sin petición extra).
    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeEnabled();
  });

  it("R47: el catálogo baja por props y alimenta los filtros de la barra", async () => {
    await renderPage();

    for (const etiqueta of ["Zona", "Tienda", "Provincia", "Cantón", "Distrito"]) {
      expect(
        await screen.findByRole("button", { name: new RegExp(`^${etiqueta}:`) }),
      ).toBeEnabled();
    }
    expect(screen.getByRole("group", { name: "Fecha de creación" })).toBeInTheDocument();
  });

  it("R62: el adminTienda NO recibe el filtro de tienda", async () => {
    resolveActorMock.mockResolvedValue({
      usuarioId: "t1",
      rol: RolValue.adminTienda,
    });
    await renderPage();

    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tienda:/ })).toBeNull();
  });
});

describe("OrdenesPage — catálogo no disponible (R64)", () => {
  it("R64: si el service responde `forbidden`, la barra va deshabilitada y la tabla sigue viva", async () => {
    catalogoMock.mockResolvedValue({ status: "forbidden" });
    await renderPage();

    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });

  it("R64: si el service responde `unauthenticated`, tampoco rompe la página", async () => {
    catalogoMock.mockResolvedValue({ status: "unauthenticated" });
    await renderPage();

    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });

  it("R64: si la lectura LANZA (error de DB propagado), la página renderiza igual", async () => {
    catalogoMock.mockRejectedValue(new Error("db caida"));
    await renderPage();

    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
    // Y el listado sigue pidiendo órdenes sin los filtros nuevos.
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("R64: los roles bloqueados siguen en notFound(), con catálogo o sin él", async () => {
    for (const rol of [RolValue.mensajero, RolValue.adminSatelite]) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u", rol });
      await expect(OrdenesPage()).rejects.toThrow();
    }
    // Ni siquiera se intenta resolver el catálogo para esos roles.
    expect(catalogoMock).not.toHaveBeenCalled();
  });

  it("el listado plano (sin filtro de estado) no resuelve catálogo alguno", async () => {
    resolveActorMock.mockResolvedValue(null);
    await renderPage();

    expect(catalogoMock).not.toHaveBeenCalled();
  });
});
