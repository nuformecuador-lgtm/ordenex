// @vitest-environment jsdom
// FICHA 454 (T2.4, R31) — el rastreo público pinta la gestión PENDIENTE de confirmar.
//
// El servidor (`RastreoPublicoService`, T1.19) añade al final de la línea el hito del resultado de
// la gestión registrada y lo marca `pendiente: true`. El modal lo lee como «<hito> · pendiente de
// confirmación» —formato único decidido por el humano el 2026-09-23, con PUNTO MEDIO— en la línea
// y en la cabecera (el hito vigente ES la última entrada, R20). Sin la marca, se pinta como hoy.
//
// Los textos esperados se escriben A MANO: compararlos con la función que los genera los dejaría
// verdes con cualquier contenido.
//
// ⏳ 2026-09-24 (FICHA 454, decisión del humano, `progress/impl_454_datos.md` §2): la entrada
// pendiente trae además `nombreResultado` y el modal pinta ESE nombre («Entregada · …»,
// «Rechazada · …») en vez de la etiqueta del hito («Entregado · …», «No entregado · …»). Los
// literales de abajo pasan de «Entregado · pendiente…» a «Entregada · pendiente…».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingNav } from "@/app/_landing/LandingNav";
import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import type { ResultadoRastreoPublico } from "@/lib/types/rastreo-publico";

vi.mock("@/lib/actions/rastreo-publico", () => ({
  consultarRastreoPublico: vi.fn(),
}));

const consultarMock = vi.mocked(consultarRastreoPublico);

const CON_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    hitoVigente: "entregado",
    actualizadoEn: "2026-09-23T15:00-06:00",
    linea: [
      { hito: "registrado", fecha: "2026-09-21T18:05-06:00" },
      { hito: "en_reparto", fecha: "2026-09-23T07:40-06:00" },
      {
        hito: "entregado",
        fecha: "2026-09-23T15:00-06:00",
        pendiente: true,
        nombreResultado: "Entregada",
      },
    ],
  },
};

/** Rechazada pendiente: el hito público es «No entregado», el nombre es el del resultado. */
const RECHAZADA_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    hitoVigente: "no_entregado",
    actualizadoEn: "2026-09-23T15:00-06:00",
    linea: [
      { hito: "registrado", fecha: "2026-09-21T18:05-06:00" },
      { hito: "en_reparto", fecha: "2026-09-23T07:40-06:00" },
      {
        hito: "no_entregado",
        fecha: "2026-09-23T15:00-06:00",
        pendiente: true,
        nombreResultado: "Rechazada",
      },
    ],
  },
};

const SIN_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    hitoVigente: "entregado",
    actualizadoEn: "2026-09-24T09:00-06:00",
    linea: [
      { hito: "registrado", fecha: "2026-09-21T18:05-06:00" },
      { hito: "en_reparto", fecha: "2026-09-23T07:40-06:00" },
      { hito: "entregado", fecha: "2026-09-24T09:00-06:00" },
    ],
  },
};

async function consultarCon(resultado: ResultadoRastreoPublico) {
  consultarMock.mockResolvedValue(resultado);
  const user = userEvent.setup();
  render(<LandingNav />);
  await user.click(screen.getByRole("button", { name: /Rastrear envío/ }));
  const modal = await screen.findByRole("dialog");
  await user.type(within(modal).getByLabelText("Número de guía"), "4321");
  await user.type(within(modal).getByLabelText("Últimos 4 dígitos del teléfono"), "8899");
  await user.click(within(modal).getByRole("button", { name: /Consultar/ }));
  await within(modal).findByText(/Guía 4321/);
  return modal;
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

describe("454/R31 — el rastreo público muestra la gestión pendiente de confirmar", () => {
  it("con gestión pendiente: la última entrada y la cabecera dicen «… · pendiente de confirmación»", async () => {
    const modal = await consultarCon(CON_PENDIENTE);

    expect(
      within(modal)
        .getAllByRole("listitem")
        .map((fila) => fila.textContent),
    ).toEqual([
      "Envío registrado2026-09-21 · 18:05",
      "En reparto2026-09-23 · 07:40",
      "Entregada · pendiente de confirmación2026-09-23 · 15:00",
    ]);
    // La cabecera (hito vigente) lo dice igual: son el mismo hito (R20).
    expect(within(modal).getAllByText("Entregada · pendiente de confirmación")).toHaveLength(2);
    // Y no la etiqueta del hito: el nombre es el del resultado.
    expect(within(modal).queryByText("Entregado · pendiente de confirmación")).toBeNull();
  });

  it("rechazada pendiente: dice «Rechazada · pendiente de confirmación», no «No entregado · …»", async () => {
    const modal = await consultarCon(RECHAZADA_PENDIENTE);

    expect(within(modal).getAllByRole("listitem").at(-1)?.textContent).toBe(
      "Rechazada · pendiente de confirmación2026-09-23 · 15:00",
    );
    expect(within(modal).getAllByText("Rechazada · pendiente de confirmación")).toHaveLength(2);
    expect(within(modal).queryByText(/No entregado/)).toBeNull();
  });

  it("sin gestión pendiente (ya aprobada): el hito se lee como siempre, sin la coletilla", async () => {
    const modal = await consultarCon(SIN_PENDIENTE);

    expect(within(modal).queryByText(/pendiente de confirmación/)).toBeNull();
    expect(within(modal).getAllByText("Entregado")).toHaveLength(2);
  });

  it("no expone nada del mensajero ni del motivo: solo el hito público y la fecha", async () => {
    const modal = await consultarCon(CON_PENDIENTE);
    const ultima = within(modal).getAllByRole("listitem").at(-1) as HTMLElement;
    expect(ultima.textContent).toBe("Entregada · pendiente de confirmación2026-09-23 · 15:00");
  });
});
