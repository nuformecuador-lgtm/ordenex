// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ZonasPageData } from "@/app/(app)/configuracion/_components/ZonasModule";

// Autorización server-side y listados pre-cargados mockeados. El page.tsx (Server
// Component real) se importa sin mockear: se ejercita su lógica de R29/R30.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const listarUsuariosMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
}));

const listarZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
}));

// Stubs identificables de los módulos cliente; el de zonas captura sus props.
vi.mock("@/app/(app)/configuracion/_components/UsuariosModule", () => ({
  UsuariosModule: () => <div data-testid="usuarios-module-stub" />,
}));

const zonasCalls: ZonasPageData[] = [];
vi.mock("@/app/(app)/configuracion/_components/ZonasModule", () => ({
  ZonasModule: (props: { initialData: ZonasPageData }) => {
    zonasCalls.push(props.initialData);
    return <div data-testid="zonas-module-stub" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  zonasCalls.length = 0;
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
});

describe("configuracion/page.tsx — autorización del módulo de zonas (R29)", () => {
  it("un rol no-maestro no ve el módulo de zonas y ve el mensaje sin permiso", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "x", rol: "admin" });
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.queryByTestId("zonas-module-stub")).not.toBeInTheDocument();
    expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
    // No se pre-carga ningún dato sensible de zonas para rol no autorizado.
    expect(listarZonasMock).not.toHaveBeenCalled();
  });

  it("sesión ausente tampoco ve el módulo de zonas (R29)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.queryByTestId("zonas-module-stub")).not.toBeInTheDocument();
    expect(listarZonasMock).not.toHaveBeenCalled();
  });
});

describe("configuracion/page.tsx — pre-carga de zonas del maestro (R30)", () => {
  it("pre-carga el listado de zonas y lo pasa al módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarZonasMock.mockResolvedValue({
      status: "ok",
      items: [
        {
          id: "z1",
          nombre: "Zona Sur",
          pagoEntrega: 1500,
          pagoRechazo: 750,
          esGam: false,
          distritosCount: 7,
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.getByTestId("zonas-module-stub")).toBeInTheDocument();
    expect(listarZonasMock).toHaveBeenCalledTimes(1);
    const arg = listarZonasMock.mock.calls[0][0] as {
      page: number;
      pageSize: number;
    };
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBeGreaterThan(0);
    expect(zonasCalls).toHaveLength(1);
    expect(zonasCalls[0].items).toHaveLength(1);
    expect(zonasCalls[0].total).toBe(1);
  });

  it("si el listado de zonas falla, pasa datos vacíos al módulo sin romper (R30)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarZonasMock.mockResolvedValue({ status: "forbidden" });
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.getByTestId("zonas-module-stub")).toBeInTheDocument();
    expect(zonasCalls[0].items).toHaveLength(0);
    expect(zonasCalls[0].total).toBe(0);
  });
});
