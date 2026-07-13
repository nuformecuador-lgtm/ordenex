// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Feature 57 (R14): el control de logout ("Salir") vive en el topbar del
// PageHeader compartido, que la home usa vía su placeholder. La home ya NO
// renderiza un botón de logout ad-hoc propio: el único control lo aporta el
// PageHeader. Se stubbea el LogoutButton (client: useRouter/useToast) para
// aislar la home; su comportamiento se cubre en LogoutButton.test.tsx.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

// Con actor null la home muestra únicamente el placeholder "Bienvenido". La
// ramificación por rol vive en HomePageRol.test.tsx / HomePageMaestro.test.tsx.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/(app)/page.tsx — sin botón de logout ad-hoc propio (feature 57, R14)", () => {
  it("la home muestra el placeholder y el único logout es el del PageHeader (sin botón ad-hoc)", async () => {
    const { default: Home } = await import("@/app/(app)/page");

    const element = await Home();
    render(element);

    // El placeholder autenticado sigue presente…
    expect(screen.getByText("Bienvenido")).toBeInTheDocument();
    // …y hay EXACTAMENTE un control de logout, el que aporta el PageHeader
    // (topbar): la home no añade un botón ad-hoc adicional en su cuerpo (R14).
    expect(screen.getAllByTestId("logout-stub")).toHaveLength(1);
  });
});
