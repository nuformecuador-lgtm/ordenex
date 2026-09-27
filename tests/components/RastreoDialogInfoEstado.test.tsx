// @vitest-environment jsdom
// FICHA 456 (T3.9, design DF/§5.1 fila 13/§8; R9, R11, R15, R28, R35, R36) — el rastreo público: el
// estado vigente, cada entrada de la línea y la señal de pendiente llevan el botón de información.
// Tocar dentro de la explicación no cierra el diálogo ni borra el resultado, y con el tema oscuro
// elegido la explicación sale con la paleta clara de la landing. La respuesta del servidor (NOMBRES,
// sin códigos) no cambia de forma: se traduce en el cliente con la inversa del catálogo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingNav } from "@/app/_landing/LandingNav";
import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import type { ResultadoRastreoPublico } from "@/lib/types/rastreo-publico";
import { textoAprobadoDe } from "../fixtures/textos-aprobados-456";

vi.mock("@/lib/actions/rastreo-publico", () => ({
  consultarRastreoPublico: vi.fn(),
}));

const consultarMock = vi.mocked(consultarRastreoPublico);

const RESULTADO: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    nombreVigente: "Entregado",
    actualizadoEn: "2026-09-23T15:00-06:00",
    linea: [
      { nombre: "En preparación", fecha: "2026-09-21T18:05-06:00" },
      { nombre: "Estado no reconocido", fecha: "2026-09-22T08:00-06:00" },
      { nombre: "En reparto", fecha: "2026-09-23T07:40-06:00" },
      { nombre: "Entregado", fecha: "2026-09-23T15:00-06:00", pendiente: true },
    ],
  },
};

async function consultar() {
  consultarMock.mockResolvedValue(RESULTADO);
  const user = userEvent.setup();
  render(<LandingNav />);
  await user.click(screen.getByRole("button", { name: /Rastrear envío/ }));
  const modal = await screen.findByRole("dialog");
  await user.type(within(modal).getByLabelText("Número de guía"), "4321");
  await user.type(within(modal).getByLabelText("Últimos 4 dígitos del teléfono"), "8899");
  await user.click(within(modal).getByRole("button", { name: /Consultar/ }));
  await within(modal).findByText(/Guía 4321/);
  return { modal, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  window.history.replaceState(null, "", "/");
});

describe("456 · rastreo público con botón de información", () => {
  it("R9/R11/R15 — botón en cada entrada y en la pendiente; el nombre no reconocido, sin botón", async () => {
    const { modal } = await consultar();
    const filas = within(modal).getAllByRole("listitem");
    const nombres = filas.map((f) => within(f).queryAllByRole("button").map((b) => b.getAttribute("aria-label")));
    expect(nombres).toEqual([
      ["Qué significa «En preparación»"],
      [],
      ["Qué significa «En reparto»"],
      ["Qué significa «pendiente de confirmación»"],
    ]);
    // Los textos visibles no cambian (R32).
    expect(filas.map((f) => f.textContent)).toEqual([
      "En preparación2026-09-21 · 18:05",
      "Estado no reconocido2026-09-22 · 08:00",
      "En reparto2026-09-23 · 07:40",
      "Entregado · pendiente de confirmación2026-09-23 · 15:00",
    ]);
  });

  it("R35 — tocar dentro de la explicación no cierra el diálogo ni borra el resultado", async () => {
    const { modal, user } = await consultar();
    const fila = within(modal).getAllByRole("listitem")[0];
    await user.click(within(fila).getByRole("button", { name: "Qué significa «En preparación»" }));
    const explicacion = await screen.findByRole("dialog", { name: "En preparación" });
    expect(explicacion).toHaveAccessibleDescription(textoAprobadoDe("En preparación"));
    await user.click(within(explicacion).getByText(textoAprobadoDe("En preparación")));
    expect(screen.getByText(/Guía 4321/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "En preparación" })).toBeNull());
    expect(screen.getByText(/Guía 4321/)).toBeTruthy();
  });

  it("R11 — la pendiente explica con el texto aprobado de «En reparto»", async () => {
    const { modal, user } = await consultar();
    const ultima = within(modal).getAllByRole("listitem").at(-1) as HTMLElement;
    await user.click(within(ultima).getByRole("button", { name: "Qué significa «pendiente de confirmación»" }));
    expect(await screen.findByRole("dialog", { name: "pendiente de confirmación" })).toHaveAccessibleDescription(
      textoAprobadoDe("En reparto"),
    );
  });

  it("R28 — con `.dark` en <html>, la explicación lleva `tema-claro`", async () => {
    document.documentElement.classList.add("dark");
    const { modal, user } = await consultar();
    const fila = within(modal).getAllByRole("listitem")[2];
    await user.click(within(fila).getByRole("button", { name: "Qué significa «En reparto»" }));
    const explicacion = await screen.findByRole("dialog", { name: "En reparto" });
    expect(explicacion.className).toContain("tema-claro");
  });
});
