// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { UsuariosPageData } from "@/app/(app)/configuracion/_components/UsuariosModule";

// Autorización server-side y listado pre-cargado mockeados. El page.tsx (Server
// Component real) se importa sin mockear: se ejercita su lógica de R1/R3/R13.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const listarUsuariosMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
}));

// Feature 24: la misma página pre-carga el listado de zonas. Se mockea la acción
// y se stubea el módulo de zonas para aislar la lógica de usuarios de este test.
const listarZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
}));
vi.mock("@/app/(app)/configuracion/_components/ZonasModule", () => ({
  ZonasModule: () => <div data-testid="zonas-module-stub" />,
}));

// Stub identificable del módulo cliente que captura las props recibidas.
const moduleCalls: UsuariosPageData[] = [];
vi.mock("@/app/(app)/configuracion/_components/UsuariosModule", () => ({
  UsuariosModule: (props: { initialData: UsuariosPageData }) => {
    moduleCalls.push(props.initialData);
    return <div data-testid="usuarios-module-stub" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  listarZonasMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
});

describe("app/(app)/configuracion/page.tsx — autorización (R1/R3)", () => {
  it("rol no autorizado no ve el módulo (R3)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "x", rol: "admin" });
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.queryByTestId("usuarios-module-stub")).not.toBeInTheDocument();
    expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
    // No se pre-carga ningún dato sensible para un rol no autorizado.
    expect(listarUsuariosMock).not.toHaveBeenCalled();
  });

  it("sesión ausente tampoco ve el módulo (R1/R4)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.queryByTestId("usuarios-module-stub")).not.toBeInTheDocument();
    expect(listarUsuariosMock).not.toHaveBeenCalled();
  });
});

describe("app/(app)/configuracion/page.tsx — pre-carga del maestro (R13)", () => {
  it("pre-carga el listado del maestro y lo pasa al módulo (R13)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarUsuariosMock.mockResolvedValue({
      status: "ok",
      items: [
        {
          id: "u1",
          nombre: "Ana",
          email: "ana@example.com",
          rolValue: "mensajero",
          estado: "activo",
          createdAt: new Date(),
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

    expect(screen.getByTestId("usuarios-module-stub")).toBeInTheDocument();
    expect(listarUsuariosMock).toHaveBeenCalledTimes(1);
    const arg = listarUsuariosMock.mock.calls[0][0] as {
      page: number;
      pageSize: number;
    };
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBeGreaterThan(0);
    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0].items).toHaveLength(1);
    expect(moduleCalls[0].total).toBe(1);
  });

  it("si el listado falla, pasa datos vacíos al módulo sin romper (R13)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarUsuariosMock.mockResolvedValue({ status: "forbidden" });
    const { default: ConfiguracionPage } = await import(
      "@/app/(app)/configuracion/page"
    );

    render(await ConfiguracionPage());

    expect(screen.getByTestId("usuarios-module-stub")).toBeInTheDocument();
    expect(moduleCalls[0].items).toHaveLength(0);
    expect(moduleCalls[0].total).toBe(0);
  });
});
