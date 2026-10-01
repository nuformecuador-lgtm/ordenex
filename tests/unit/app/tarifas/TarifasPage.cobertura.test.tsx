// @vitest-environment jsdom
// Ficha 465 (T9) — montaje del bloque «Cobertura» en la página Tarifas. Cubre R1: el maestro ve
// «Descargar cobertura»; cualquier otro rol (o sin sesión) solo ve el aviso de permiso.
// El `page.tsx` (Server Component real) se ejercita sin mockear; se doblan el resolver de sesión,
// las lecturas de pre-carga y el módulo de zonas (fuera de alcance de esta ficha).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const { resolveActorMock, listarCoberturaMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  listarCoberturaMock: vi.fn(),
}));
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));
vi.mock("@/lib/actions/geografia", () => ({
  listarArbolGeografico: vi.fn(async () => ({ status: "ok", provincias: [] })),
}));
vi.mock("@/lib/actions/vehiculos", () => ({
  listarVehiculos: vi.fn(async () => ({ status: "ok", items: [] })),
}));
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
}));
vi.mock("@/lib/actions/cobertura", () => ({
  listarCoberturaDistritos: (...a: unknown[]) => listarCoberturaMock(...a),
}));
vi.mock("@/app/(app)/configuracion/tarifas/_components/ZonasTarifasModule", () => ({
  ZonasTarifasModule: () => <div data-testid="zonas-tarifas-stub" />,
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

async function importPage() {
  const mod = await import("@/app/(app)/configuracion/tarifas/page");
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("465/R1 — bloque «Cobertura» en Tarifas", () => {
  it("el maestro ve «Descargar cobertura» con su línea de ayuda, antes de Costos por zona", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m1", rol: "maestro" });
    const TarifasPage = await importPage();
    render(await TarifasPage());

    const bloque = screen.getByRole("region", { name: "Cobertura" });
    expect(
      within(bloque).getByRole("button", { name: "Descargar cobertura Cobertura por distrito" }),
    ).toHaveTextContent("Descargar cobertura");
    expect(
      within(bloque).getByText(
        "Descarga un Excel con cada distrito, si llegamos a él y con qué zona.",
      ),
    ).toBeInTheDocument();

    const zonas = screen.getByTestId("zonas-tarifas-stub");
    expect(
      bloque.compareDocumentPosition(zonas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Montar la página no lee la cobertura: se lee al pulsar (R4).
    expect(listarCoberturaMock).not.toHaveBeenCalled();
  });

  it("otro rol no ve el control: solo el aviso de permiso", async () => {
    const otros: RolValue[] = ["admin", "adminTienda", "adminSatelite", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "x", rol });
      const TarifasPage = await importPage();
      render(await TarifasPage());
      expect(screen.queryByRole("button", { name: /Descargar cobertura/ })).toBeNull();
      expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
      cleanup();
    }
  });

  it("sin sesión tampoco ve el control", async () => {
    resolveActorMock.mockResolvedValue(null);
    const TarifasPage = await importPage();
    render(await TarifasPage());
    expect(screen.queryByRole("button", { name: /Descargar cobertura/ })).toBeNull();
    expect(screen.getByText(/No tienes permiso/i)).toBeInTheDocument();
  });
});
