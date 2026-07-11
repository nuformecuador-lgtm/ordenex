// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumnsAdminTienda } from "@/app/(app)/_components/ordenes-columns-admin-tienda";

/**
 * Reuso estructural (feature 26, R10): tanto `/ordenes` como el dashboard del
 * adminTienda montan EL MISMO componente `OrdenesModule` (única implementación de
 * tabla + fetch). Se mockea `OrdenesModule` para capturar sus invocaciones y
 * verificar que no existe una segunda implementación de DataTable/fetch.
 */
const moduleCalls: Array<{ columns?: Column<OrdenListItemDTO>[] }> = [];

vi.mock("@/app/(app)/ordenes/_components/OrdenesModule", () => ({
  OrdenesModule: (props: { columns?: Column<OrdenListItemDTO>[] } = {}) => {
    moduleCalls.push(props);
    return <div data-testid="ordenes-module-stub" />;
  },
}));

// La página /ordenes resuelve el actor server-side para gatear la carga masiva.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

beforeEach(() => {
  moduleCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("Reuso de OrdenesModule (R10)", () => {
  it("/ordenes monta OrdenesModule sin columnas custom (variante por defecto)", async () => {
    const { default: OrdenesPage } = await import("@/app/(app)/ordenes/page");
    render(await OrdenesPage());

    expect(screen.getByTestId("ordenes-module-stub")).toBeInTheDocument();
    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0].columns).toBeUndefined();
  });

  it("el dashboard del adminTienda monta el MISMO OrdenesModule con las columnas sin 'Tienda'", async () => {
    const { AdminTiendaDashboard } = await import(
      "@/app/(app)/_components/AdminTiendaDashboard"
    );
    render(AdminTiendaDashboard());

    expect(screen.getByTestId("ordenes-module-stub")).toBeInTheDocument();
    expect(moduleCalls).toHaveLength(1);
    // Reutiliza el módulo compartido pasando las columnas de presentación (R11),
    // sin una segunda DataTable/fetch propios.
    expect(moduleCalls[0].columns).toBe(ordenesColumnsAdminTienda);
    expect(moduleCalls[0].columns).toHaveLength(4);
    expect(
      moduleCalls[0].columns?.some((c) => c.id === "tienda"),
    ).toBe(false);
  });
});
