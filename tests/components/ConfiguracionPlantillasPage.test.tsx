// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar la autorización/pre-carga.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { PlantillasPageData } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";

// Feature 107 (R3) — la página resuelve el rol SOLO server-side (solo `maestro`)
// y pre-carga la primera página del listado. Se mockean el resolver y la action de
// lectura; el `page.tsx` (Server Component real) se ejercita sin mockear. El módulo
// cliente se stubea para capturar las props recibidas.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const listarPlantillasMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
}));

const moduleCalls: PlantillasPageData[] = [];
vi.mock("@/app/(app)/configuracion/plantillas/_components/PlantillasModule", () => ({
  PlantillasModule: (props: { initialData: PlantillasPageData }) => {
    moduleCalls.push(props.initialData);
    return <div data-testid="plantillas-module-stub" />;
  },
}));

async function importPage() {
  const mod = await import("@/app/(app)/configuracion/plantillas/page");
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("ConfiguracionPlantillasPage — control de acceso (R3)", () => {
  it("R3: rol no maestro NO ve el módulo y no pre-carga datos", async () => {
    const otros: RolValue[] = ["admin", "adminTienda", "adminSatelite", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "x", rol });
      const PlantillasPage = await importPage();
      render(await PlantillasPage());

      expect(
        screen.queryByTestId("plantillas-module-stub"),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
      cleanup();
    }
    expect(listarPlantillasMock).not.toHaveBeenCalled();
  });

  it("R3: sesión ausente tampoco ve el módulo", async () => {
    resolveActorMock.mockResolvedValue(null);
    const PlantillasPage = await importPage();
    render(await PlantillasPage());

    expect(
      screen.queryByTestId("plantillas-module-stub"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
    expect(listarPlantillasMock).not.toHaveBeenCalled();
  });
});

describe("ConfiguracionPlantillasPage — pre-carga del maestro", () => {
  it("el maestro ve el módulo y la primera página se pasa como initialData", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarPlantillasMock.mockResolvedValue({
      status: "ok",
      items: [
        {
          id: "p1",
          nombre: "bienvenida",
          cuerpo: "Hola {{usuario}}",
          estado: "pending",
          variables: ["usuario"],
          createdAt: new Date(),
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const PlantillasPage = await importPage();
    render(await PlantillasPage());

    expect(screen.getByTestId("plantillas-module-stub")).toBeInTheDocument();
    expect(listarPlantillasMock).toHaveBeenCalledTimes(1);
    const arg = listarPlantillasMock.mock.calls[0][0] as {
      page: number;
      pageSize: number;
    };
    expect(arg.page).toBe(1);
    expect(arg.pageSize).toBeGreaterThan(0);
    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0].items).toHaveLength(1);
    expect(moduleCalls[0].total).toBe(1);
  });

  it("si la pre-carga no es ok, pasa un listado vacío sin romper", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarPlantillasMock.mockResolvedValue({ status: "forbidden" });
    const PlantillasPage = await importPage();
    render(await PlantillasPage());

    expect(screen.getByTestId("plantillas-module-stub")).toBeInTheDocument();
    expect(moduleCalls[0].items).toHaveLength(0);
    expect(moduleCalls[0].total).toBe(0);
    expect(moduleCalls[0].pageSize).toBeGreaterThan(0);
  });
});
