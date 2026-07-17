// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContactoButtons } from "@/components/shared/ContactoButtons";

// Feature 87 (T11) — compuesto compartido de botones de contacto. Cubre R12 (dos botones),
// R15 (wa.me con el telefono normalizado a 506...) y R16 (tel:). Se mockea window.open
// (jsdom no navega) para afirmar la URL construida en cada click.
describe("ContactoButtons", () => {
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("R12: renderiza un boton Llamar y un boton WhatsApp accesibles", () => {
    render(<ContactoButtons telefono="88887777" nombre="Ana Cliente" />);

    expect(
      screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("R16: el boton Llamar abre el enlace tel: con el telefono de la orden", async () => {
    const user = userEvent.setup();
    render(<ContactoButtons telefono="88887777" nombre="Ana Cliente" />);

    await user.click(screen.getByRole("button", { name: "Llamar a Ana Cliente" }));

    expect(openSpy).toHaveBeenCalledWith("tel:88887777", "_self");
  });

  it("R15: el boton WhatsApp usa el telefono normalizado (wa.me/506...) — corrige el bug heredado", async () => {
    const user = userEvent.setup();
    render(<ContactoButtons telefono="88887777" nombre="Ana Cliente" />);

    await user.click(screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }));

    expect(openSpy).toHaveBeenCalledWith("https://wa.me/50688887777", "_blank");
  });

  it("R15: no re-prefija un numero que ya trae 506", async () => {
    const user = userEvent.setup();
    render(<ContactoButtons telefono="50688887777" nombre="Ana Cliente" />);

    await user.click(screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }));

    expect(openSpy).toHaveBeenCalledWith("https://wa.me/50688887777", "_blank");
  });
});
