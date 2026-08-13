// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  // 2026-08-12 (pedido humano) — TOOLTIP en los dos botones. Eran solo-icono y sin ayuda
  // visual en sus CUATRO consumidores (`NovedadAcciones`, `GestionarOrdenPanel`,
  // `EnviarPlantillaWhatsappButton`, `RecoleccionModule`), así que el arreglo vive en el
  // componente y no en una pantalla: envolverlos desde fuera habría dejado a las otras tres
  // con el mismo icono mudo.
  describe("tooltips (2026-08-12)", () => {
    // Por FOCO y no por hover: el hover de base-ui pasa por su lógica de puntero, que en
    // jsdom no se activa con los eventos de `userEvent.hover`. El foco ejerce el MISMO
    // camino de apertura y de paso cubre al usuario de teclado.
    it.each([
      ["Llamar a Ana Cliente", "Llamar"],
      ["WhatsApp a Ana Cliente", "WhatsApp"],
    ])("%s revela el tooltip corto al enfocarse", async (nombre, tooltip) => {
      render(<ContactoButtons telefono="88887777" nombre="Ana Cliente" />);

      fireEvent.focus(screen.getByRole("button", { name: nombre }));

      expect(await screen.findByText(tooltip)).toBeInTheDocument();
    });

    // Lo que este caso protege es lo que se rompe CALLANDO: el tooltip NO es el nombre del
    // botón. Si alguien sustituye el `aria-label` por el texto corto "porque ya está el
    // tooltip", el control pierde el nombre que lo distingue de los de las demás filas —y
    // los tests de arriba fallarían por "no encuentro el botón", no por "no se puede
    // nombrar". Aquí se afirma el `aria-label` LETRA POR LETRA.
    it("el tooltip NO reemplaza al aria-label: los nombres accesibles se conservan", () => {
      render(<ContactoButtons telefono="88887777" nombre="Ana Cliente" />);

      const llamar = screen.getByRole("button", { name: "Llamar a Ana Cliente" });
      const whatsapp = screen.getByRole("button", { name: "WhatsApp a Ana Cliente" });

      expect(llamar).toHaveAttribute("aria-label", "Llamar a Ana Cliente");
      expect(whatsapp).toHaveAttribute("aria-label", "WhatsApp a Ana Cliente");
      // Solo-icono: sin texto visible y con el svg marcado como decorativo, para que quien
      // los anuncie sea el `aria-label` y no el dibujo.
      for (const boton of [llamar, whatsapp]) {
        expect(boton.textContent).toBe("");
        expect(boton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      }
    });

    it("con `mostrarWhatsapp={false}` no queda un tooltip huérfano de WhatsApp", () => {
      render(
        <ContactoButtons telefono="88887777" nombre="Ana Cliente" mostrarWhatsapp={false} />,
      );

      expect(
        screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "WhatsApp a Ana Cliente" }),
      ).toBeNull();
      expect(screen.queryByText("WhatsApp")).toBeNull();
    });
  });
});
