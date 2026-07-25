// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar la autorización/pre-carga.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
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

// NOTA (chore fix-dev-init-verde): el bloque "pre-carga de zonas del maestro (R30)" se retiró.
// La gestión de zonas se movió de `/configuracion` a `/configuracion/tarifas` (rama flow,
// commit "remove zones from config>user"): `ConfiguracionPage` ya NO monta `ZonasModule` ni
// pre-carga `listarZonas`. Esos tests probaban una funcionalidad deliberadamente reubicada. Si
// la reubicación NO fuese la intención final, restaurar `ZonasModule` en la página es una
// decisión de UI para frontend_dev (y entonces estos tests volverían).
