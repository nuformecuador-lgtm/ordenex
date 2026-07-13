// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Feature 57 (R14): el control "Cerrar sesión" se movió al shell (SidebarFooter);
// la home ya NO renderiza su propio botón ad-hoc. Con actor null la home muestra
// únicamente el placeholder "Bienvenido". La ramificación por rol vive en
// HomePageRol.test.tsx / HomePageMaestro.test.tsx.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/(app)/page.tsx — sin botón de logout propio (feature 57, R14)", () => {
  it("la home ya no renderiza su propio botón Cerrar sesión", async () => {
    const { default: Home } = await import("@/app/(app)/page");

    const element = await Home();
    render(element);

    // El placeholder autenticado sigue presente…
    expect(screen.getByText("Bienvenido")).toBeInTheDocument();
    // …pero el control de logout ya no vive aquí (único control en el sidebar).
    expect(
      screen.queryByRole("button", { name: "Cerrar sesión" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Cerrar sesión")).not.toBeInTheDocument();
  });
});
