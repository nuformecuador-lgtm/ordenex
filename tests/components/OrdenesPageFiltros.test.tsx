// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  configure,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { RolValue } from "@prisma/client";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";

// Feature 144 / TB2.5 (R47, R64) — la PAGE resuelve el catálogo server-side y lo
// baja por props; si no se puede resolver, pasa `null` y la página sigue viva.

// Los `findBy*` de testing-library NO usan el `testTimeout: 20000` de vitest: se rigen
// por el `asyncUtilTimeout` de `waitFor`, cuyo default es 1000 ms. Cada caso de este
// archivo arrastra el render completo del arbol de la page, y bajo la contencion de CPU
// de la suite entera ese segundo no alcanza (el archivo pasa siempre en aislamiento y
// fallaba en ~2 de cada 3 corridas completas). Se sube el margen para TODAS las esperas
// del archivo: no cambia lo que se afirma, solo deja de medir la carga de la maquina.
// Mismo razonamiento que el `testTimeout: 20000` de `vitest.config.ts`.
configure({ asyncUtilTimeout: 10000 });

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

/**
 * Pone en la barra los filtros que se piden, por su etiqueta.
 *
 * La barra de `/ordenes` ya NO nace con los controles montados: arranca con el buscador
 * solo y cada filtro se PIDE en el selector "Filtros". Sin este paso no existe el
 * disparador `"<Etiqueta>: …"`, así que esto es la precondición que antes daba el
 * render de la page — no cambia lo que cada caso afirma sobre el catálogo.
 */
async function ponerFiltros(
  user: ReturnType<typeof userEvent.setup>,
  ...etiquetas: string[]
) {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  for (const etiqueta of etiquetas) {
    await user.click(within(selector).getByRole("option", { name: etiqueta }));
  }
  // Marcar NO cierra el selector (se piden varios del tirón); se cierra a mano para que
  // su panel no tape los controles recién montados.
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
}

/** Etiquetas que el selector "Filtros" OFRECE, en su orden. */
async function filtrosOfrecidos(
  user: ReturnType<typeof userEvent.setup>,
): Promise<string[]> {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  const etiquetas = within(selector)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
  return etiquetas;
}

describe("OrdenesPage — catálogo de filtros (R47)", () => {
  it("R47: el catálogo se resuelve EN EL SERVIDOR, en UNA sola llamada al cargar la página", async () => {
    const user = userEvent.setup();
    await renderPage();

    expect(catalogoMock).toHaveBeenCalledTimes(1);
    // Los filtros quedan operativos con las opciones ya presentes: pedir uno NO dispara
    // una segunda resolución del catálogo (esa es la mitad de R47 que este caso mide).
    await ponerFiltros(user, "Zona");
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeEnabled();
    expect(catalogoMock).toHaveBeenCalledTimes(1);
  });

  it("R47: el catálogo baja por props y alimenta los filtros de la barra", async () => {
    const user = userEvent.setup();
    await renderPage();

    const MULTI = ["Zona", "Tienda", "Provincia", "Cantón", "Distrito"];
    await ponerFiltros(user, ...MULTI, "Fecha de creación");

    for (const etiqueta of MULTI) {
      // Habilitado = el catálogo llegó con opciones: `FilterComponent` deshabilita
      // cualquier `multi` sin opciones, así que esto distingue "alimentado" de "vacío".
      expect(
        await screen.findByRole("button", { name: new RegExp(`^${etiqueta}:`) }),
      ).toBeEnabled();
    }
    expect(screen.getByRole("group", { name: "Fecha de creación" })).toBeInTheDocument();
  });

  it("R62: el adminTienda NO recibe el filtro de tienda", async () => {
    const user = userEvent.setup();
    resolveActorMock.mockResolvedValue({
      usuarioId: "t1",
      rol: RolValue.adminTienda,
    });
    await renderPage();

    // Al adminTienda no se le OFRECE la tienda: no hay forma de ponerla en la barra.
    const ofrecidos = await filtrosOfrecidos(user);
    expect(ofrecidos).not.toContain("Tienda");
    expect(ofrecidos).toContain("Zona");

    // Y pidiendo TODO lo que se le ofrece, sigue sin aparecer.
    await ponerFiltros(user, ...ofrecidos);
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tienda:/ })).toBeNull();
  });
});

describe("OrdenesPage — catálogo no disponible (R64)", () => {
  it("R64: si el service responde `forbidden`, la barra va deshabilitada y la tabla sigue viva", async () => {
    const user = userEvent.setup();
    catalogoMock.mockResolvedValue({ status: "forbidden" });
    await renderPage();

    await ponerFiltros(user, "Zona");
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });

  it("R64: si el service responde `unauthenticated`, tampoco rompe la página", async () => {
    const user = userEvent.setup();
    catalogoMock.mockResolvedValue({ status: "unauthenticated" });
    await renderPage();

    await ponerFiltros(user, "Zona");
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });

  it("R64: si la lectura LANZA (error de DB propagado), la página renderiza igual", async () => {
    const user = userEvent.setup();
    catalogoMock.mockRejectedValue(new Error("db caida"));
    await renderPage();

    await ponerFiltros(user, "Zona");
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
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
