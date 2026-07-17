// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// La landing es un Server Component sin datos: se importa y renderiza directo
// (no hay fetch ni async). Se importa vía `await import("@/app/page")` para no
// arrastrar el módulo a otros tests del mismo archivo.
describe("app/page.tsx — landing pública (feature 86, R2–R5)", () => {
  it("R2: el topbar tiene el logo y los enlaces «Trabaja con nosotros» → /postulacion e «Ingreso» → /login", async () => {
    const { default: LandingPage } = await import("@/app/page");
    render(LandingPage());

    // El logo (wordmark) aparece (topbar + hero).
    expect(screen.getAllByText("Ordenex").length).toBeGreaterThanOrEqual(1);

    const trabaja = screen.getAllByRole("link", { name: "Trabaja con nosotros" });
    expect(trabaja.length).toBeGreaterThanOrEqual(1);
    trabaja.forEach((el) => expect(el).toHaveAttribute("href", "/postulacion"));

    const ingreso = screen.getAllByRole("link", { name: "Ingreso" });
    expect(ingreso.length).toBeGreaterThanOrEqual(1);
    ingreso.forEach((el) => expect(el).toHaveAttribute("href", "/login"));
  });

  it("R3: el hero incluye los 2 CTA («Ingreso» → /login, «Trabaja con nosotros» → /postulacion)", async () => {
    const { default: LandingPage } = await import("@/app/page");
    render(LandingPage());

    // Dos apariciones de cada enlace (topbar + hero CTA).
    expect(
      screen.getAllByRole("link", { name: "Ingreso" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("link", { name: "Trabaja con nosotros" }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("R4: reutiliza la paleta de marca (navy/brand)", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(LandingPage());

    expect(container.querySelector(".bg-navy")).not.toBeNull();
    expect(container.querySelector(".bg-brand")).not.toBeNull();
  });

  it("R5: el único copy descriptivo es «Plataforma de logística y entregas Ordenex» (sin marketing inventado)", async () => {
    const { default: LandingPage } = await import("@/app/page");
    render(LandingPage());

    expect(
      screen.getByText("Plataforma de logística y entregas Ordenex"),
    ).toBeInTheDocument();

    // No hay secciones de marketing inventadas (servicios, testimonios, precios…).
    expect(screen.queryByText(/testimonio/i)).toBeNull();
    expect(screen.queryByText(/precio/i)).toBeNull();
    expect(screen.queryByText(/servicio/i)).toBeNull();
  });
});
