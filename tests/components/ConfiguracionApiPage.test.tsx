// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar la autorización/pre-carga.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { ApiKeysPageData } from "@/app/(app)/configuracion/api/_components/ApiKeysModule";

// Feature 82 (R11/R12/R13) — la página resuelve el rol SOLO server-side (solo
// `maestro`) y pre-carga la primera página del listado. Se mockean el resolver y
// la action de lectura; el `page.tsx` (Server Component real) se ejercita sin
// mockear. El módulo cliente se stubea para capturar las props recibidas.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const listarApiKeysMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  listarApiKeys: (...a: unknown[]) => listarApiKeysMock(...a),
}));

const moduleCalls: ApiKeysPageData[] = [];
vi.mock("@/app/(app)/configuracion/api/_components/ApiKeysModule", () => ({
  ApiKeysModule: (props: { initialData: ApiKeysPageData }) => {
    moduleCalls.push(props.initialData);
    return <div data-testid="api-keys-module-stub" />;
  },
}));

async function importPage() {
  const mod = await import("@/app/(app)/configuracion/api/page");
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("ConfiguracionApiPage — control de acceso (R11)", () => {
  it("R11: rol no maestro NO ve el módulo y no pre-carga datos", async () => {
    const otros: RolValue[] = ["admin", "adminTienda", "adminSatelite", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "x", rol });
      const ApiPage = await importPage();
      render(await ApiPage());

      expect(screen.queryByTestId("api-keys-module-stub")).not.toBeInTheDocument();
      expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
      cleanup();
    }
    expect(listarApiKeysMock).not.toHaveBeenCalled();
  });

  it("R11: sesión ausente tampoco ve el módulo", async () => {
    resolveActorMock.mockResolvedValue(null);
    const ApiPage = await importPage();
    render(await ApiPage());

    expect(screen.queryByTestId("api-keys-module-stub")).not.toBeInTheDocument();
    expect(listarApiKeysMock).not.toHaveBeenCalled();
  });
});

describe("ConfiguracionApiPage — pre-carga del maestro (R12/R13)", () => {
  it("R12: el maestro ve el módulo y la primera página se pasa como initialData", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarApiKeysMock.mockResolvedValue({
      status: "ok",
      items: [
        {
          id: "k1",
          identificador: "integracion-erp",
          keyPrefix: "ordx_ab12cd3",
          usuarioId: "u1",
          usuarioEmail: "apikey+integracion-erp@apikey.invalid",
          createdAt: new Date(),
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const ApiPage = await importPage();
    render(await ApiPage());

    expect(screen.getByTestId("api-keys-module-stub")).toBeInTheDocument();
    expect(listarApiKeysMock).toHaveBeenCalledTimes(1);
    const arg = listarApiKeysMock.mock.calls[0][0] as {
      page: number;
      pageSize: number;
    };
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBeGreaterThan(0);
    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0].items).toHaveLength(1);
    expect(moduleCalls[0].total).toBe(1);
  });

  it("R13: si la pre-carga no es ok, pasa un listado vacío sin romper", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarApiKeysMock.mockResolvedValue({ status: "forbidden" });
    const ApiPage = await importPage();
    render(await ApiPage());

    expect(screen.getByTestId("api-keys-module-stub")).toBeInTheDocument();
    expect(moduleCalls[0].items).toHaveLength(0);
    expect(moduleCalls[0].total).toBe(0);
    expect(moduleCalls[0].pageSize).toBeGreaterThan(0);
  });
});
