// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfiguracionPage from "@/app/(app)/configuracion/page";
import PerfilPage from "@/app/(app)/perfil/page";

// Nota: `/ordenes` ya NO es placeholder — tiene vista real (DataTable + SWR),
// cubierta por `tests/components/OrdenesPage.test.tsx`. Por eso no se incluye aquí.
describe("Páginas placeholder de destino (R17)", () => {
  it("cada ruta renderiza su título (R17)", () => {
    const cases: Array<{ Page: () => React.JSX.Element; title: string }> = [
      { Page: ConfiguracionPage, title: "Configuración" },
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
