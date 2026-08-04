// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumnsAdminTienda } from "@/app/(app)/_components/ordenes-columns-admin-tienda";
// Los módulos bajo prueba se importan estáticamente (no con `await import()`
// dentro del `it`) para que su carga/transformación NO cuente contra
// `testTimeout`: era la causa medida del flake de esta suite. Los `vi.mock` de
// abajo son *hoisted* por Vitest, así que se aplican igual antes de estas
// importaciones.
import OrdenesPage from "@/app/(app)/ordenes/page";
import { AdminTiendaDashboard } from "@/app/(app)/_components/AdminTiendaDashboard";

/**
 * Reuso estructural (feature 26, R10): tanto `/ordenes` como el dashboard del
 * adminTienda montan EL MISMO componente `OrdenesModule` (única implementación de
 * tabla + fetch). Se mockea `OrdenesModule` para capturar sus invocaciones y
 * verificar que no existe una segunda implementación de DataTable/fetch.
 */
// `OrdenesListado` usa `useRouter` (navegación al escanear el QR de una etiqueta),
// que exige el App Router montado: se mockea como en el resto de la suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

// Feature 57: el PageHeader monta el LogoutButton (client: useRouter/useToast).
// Se stubbea para aislar el render; su comportamiento se cubre en LogoutButton.test.tsx.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

beforeEach(() => {
  moduleCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("Reuso de OrdenesModule (R10)", () => {
  it("/ordenes monta OrdenesModule sin columnas custom (variante por defecto)", async () => {
    render(await OrdenesPage());

    expect(screen.getByTestId("ordenes-module-stub")).toBeInTheDocument();
    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0].columns).toBeUndefined();
  });

  it("el dashboard del adminTienda monta el MISMO OrdenesModule con las columnas sin 'Tienda'", async () => {
    render(AdminTiendaDashboard());

    expect(screen.getByTestId("ordenes-module-stub")).toBeInTheDocument();
    expect(moduleCalls).toHaveLength(1);
    // Reutiliza el módulo compartido pasando las columnas de presentación (R11),
    // sin una segunda DataTable/fetch propios.
    expect(moduleCalls[0].columns).toBe(ordenesColumnsAdminTienda);
    // 19 columnas del listado del maestro (18 + "Intentos", feature 160/R22),
    // menos "tienda" = 18. La columna "zona" SÍ se muestra al adminTienda
    // (decisión del humano 2026-07-14).
    expect(moduleCalls[0].columns).toHaveLength(18);
    expect(
      moduleCalls[0].columns?.some((c) => c.id === "tienda"),
    ).toBe(false);
    // La columna "zona" está presente (ya NO se oculta al adminTienda).
    expect(
      moduleCalls[0].columns?.some((c) => c.id === "zona"),
    ).toBe(true);
  });
});
