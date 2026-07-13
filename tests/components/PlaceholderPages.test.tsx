// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PerfilPage from "@/app/(app)/perfil/page";

// Feature 57: el PageHeader del topbar (que estas páginas usan) monta el
// LogoutButton (client: useRouter/useToast). Se stubbea para aislar el título.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

// Nota: `/ordenes` ya NO es placeholder — tiene vista real (DataTable + SWR),
// cubierta por `tests/components/OrdenesPage.test.tsx`. `/configuracion` tampoco:
// ahora monta el módulo de gestión de usuarios (feature 25, Server Component que
// valida rol), cubierto por `tests/integration/configuracion/usuarios-page.test.tsx`.
describe("Páginas placeholder de destino (R17)", () => {
  it("cada ruta renderiza su título (R17)", () => {
    const cases: Array<{ Page: () => React.JSX.Element; title: string }> = [
      { Page: PerfilPage, title: "Perfil" },
    ];

    for (const { Page, title } of cases) {
      const { unmount } = render(<Page />);
      expect(
        screen.getByRole("heading", { name: title, level: 1 }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
