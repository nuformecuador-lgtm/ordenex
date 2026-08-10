// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Los módulos bajo prueba se importan estáticamente (no con `await import()`
// dentro del `it`) para que su carga/transformación NO cuente contra
// `testTimeout`: era la causa medida del flake de esta suite. Los `vi.mock` de
// abajo son *hoisted* por Vitest, así que se aplican igual antes de estas
// importaciones.
import OrdenesPage from "@/app/(app)/ordenes/page";

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

  // El segundo caso de este archivo montaba el dashboard del adminTienda para afirmar
  // que REUTILIZABA el mismo `OrdenesModule` con sus columnas propias. Esa pantalla se
  // retiro el 2026-08-10 (pedido humano) junto con su archivo de columnas, asi que el
  // caso se queda SIN SUJETO: no es que deje de cumplirse, es que ya no hay dashboard
  // que montar. El reuso que R10 protege sigue cubierto por el caso de arriba.
});
