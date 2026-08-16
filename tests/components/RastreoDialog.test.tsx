// @vitest-environment jsdom
// Feature 229 (T3.2/T3.3) — el MODAL de rastreo público tal como lo monta la nav de la landing.
// Cubre R1, R26, R27, R28, R29 (la mitad que se puede ver renderizando), R30 y R31.
//
// Se renderiza `LandingNav()` y no el diálogo suelto en los casos de R1: lo que la feature
// promete es que **el botón que ya existía** deja de ser inerte, y eso solo es comprobable
// desde la nav. `LandingNav` es Server Component, pero es una función síncrona sin `await`:
// invocarla devuelve su árbol y Testing Library lo monta igual que cualquier otro.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingNav } from "@/app/_landing/LandingNav";
import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import type { ResultadoRastreoPublico } from "@/lib/types/rastreo-publico";

// La Server Action es el único borde que el modal toca. Se dobla porque este test mide la
// SUPERFICIE, no la proyección: el servidor tiene sus propios tests (T2.4/T2.6).
vi.mock("@/lib/actions/rastreo-publico", () => ({
  consultarRastreoPublico: vi.fn(),
}));

const consultarMock = vi.mocked(consultarRastreoPublico);

const ENVIO: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    hitoVigente: "en_reparto",
    actualizadoEn: "2026-08-15T09:30-06:00",
    linea: [
      { hito: "registrado", fecha: "2026-08-13T18:05-06:00" },
      { hito: "en_transito", fecha: "2026-08-14T07:40-06:00" },
      { hito: "en_reparto", fecha: "2026-08-15T09:30-06:00" },
    ],
  },
};

const RECHAZO_UNICO =
  "No encontramos un envío con esos datos. Revisa el número de guía y los últimos 4 dígitos del teléfono.";

const disparador = () => screen.getByRole("button", { name: /Rastrear envío/ });
const dialogo = () => screen.getByRole("dialog");
const campoGuia = () => within(dialogo()).getByLabelText("Número de guía");
const campoFactor = () => within(dialogo()).getByLabelText("Últimos 4 dígitos del teléfono");
const enviar = () => within(dialogo()).getByRole("button", { name: /Consultar/ });

/** Abre el modal desde el disparador REAL de la nav y devuelve el `user` ya configurado. */
async function abrirDesdeLaNav() {
  const user = userEvent.setup();
  render(<LandingNav />);
  await user.click(disparador());
  await screen.findByRole("dialog");
  return user;
}

/** Rellena los dos campos y envía. */
async function consultar(user: ReturnType<typeof userEvent.setup>) {
  await user.type(campoGuia(), "4321");
  await user.type(campoFactor(), "8899");
  await user.click(enviar());
}

beforeEach(() => {
  vi.clearAllMocks();
  consultarMock.mockResolvedValue(ENVIO);
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

// ---------------------------------------------------------------------------

describe("R1 — el disparador de la landing ya no es inerte", () => {
  it("el botón «Rastrear envío» ya no está deshabilitado y su activación monta el diálogo", async () => {
    const user = userEvent.setup();
    render(<LandingNav />);

    // La mitad que más importa: hasta esta feature el botón tenía `disabled` puesto.
    expect(disparador()).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(disparador());

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("hay UN solo disparador: la nav activa el botón que ya tenía, no añade otro", async () => {
    render(<LandingNav />);
    expect(screen.getAllByRole("button", { name: /Rastrear envío/ })).toHaveLength(1);
  });
});

describe("R26 — el resultado se pinta DENTRO del mismo diálogo, sin navegar", () => {
  it("pinta el resultado en el mismo diálogo sin navegar", async () => {
    const urlAntes = window.location.href;
    const user = await abrirDesdeLaNav();

    await consultar(user);

    const modal = await screen.findByRole("dialog");
    expect(await within(modal).findByText(/Guía 4321/)).toBeInTheDocument();
    // «En reparto» sale DOS veces y es correcto: es el hito vigente y, a la vez, el último
    // de la línea — R20 dice que no pueden divergir.
    expect(within(modal).getAllByText("En reparto")).toHaveLength(2);
    // La línea entera vive dentro del MISMO diálogo, en orden ascendente.
    expect(
      within(modal)
        .getAllByRole("listitem")
        .map((fila) => fila.textContent),
    ).toEqual([
      "Envío registrado2026-08-13 · 18:05",
      "En tránsito2026-08-14 · 07:40",
      "En reparto2026-08-15 · 09:30",
    ]);
    // Y no se navegó: ni ruta nueva, ni la guía en la URL (R30 se apoya en esto).
    expect(window.location.href).toBe(urlAntes);
  });

  it("lo que viaja al servidor son exactamente los dos datos de identificación", async () => {
    const user = await abrirDesdeLaNav();
    await consultar(user);

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
    expect(consultarMock).toHaveBeenCalledWith({ numGuia: "4321", factor: "8899" });
  });
});

describe("R27 — estado de carga y sin reenvío duplicado", () => {
  it("durante la consulta inhabilita el envío e invoca la acción una sola vez", async () => {
    // Promesa retenida a mano: es el único modo de observar el estado PENDIENTE, que es
    // justo lo que el requisito mide.
    let resolver: (valor: ResultadoRastreoPublico) => void = () => {};
    consultarMock.mockImplementation(
      () =>
        new Promise<ResultadoRastreoPublico>((cumplir) => {
          resolver = cumplir;
        }),
    );

    const user = await abrirDesdeLaNav();
    await user.type(campoGuia(), "4321");
    await user.type(campoFactor(), "8899");
    await user.click(enviar());

    // El control de envío está inhabilitado y el estado de carga se anuncia.
    await waitFor(() => expect(enviar()).toBeDisabled());
    expect(enviar()).toHaveAttribute("aria-busy", "true");
    expect(within(dialogo()).getByRole("status")).toHaveTextContent("Consultando…");

    // Segunda activación seguida: no sale una segunda consulta.
    await user.click(enviar());
    expect(consultarMock).toHaveBeenCalledTimes(1);

    resolver(ENVIO);
    expect(
      await within(await screen.findByRole("dialog")).findByText(/Guía 4321/),
    ).toBeInTheDocument();
    await waitFor(() => expect(enviar()).toBeEnabled());
  });
});

describe("R28 — el rechazo es uno solo y no discrimina", () => {
  it.each([
    ["guía inexistente", "9999", "8899"],
    ["segundo factor errado", "4321", "0000"],
    ["orden borrada", "4322", "8899"],
  ])("los tres casos de rechazo muestran el mismo texto y ninguna línea de tiempo (%s)", async (
    _caso,
    guia,
    factor,
  ) => {
    // El servidor devuelve el MISMO `no_encontrado` para los cuatro casos: la UI no puede
    // distinguirlos ni aunque quisiera, y eso es el mecanismo de R7, no un descuido.
    consultarMock.mockResolvedValue({ estado: "no_encontrado" });
    const user = await abrirDesdeLaNav();
    await user.type(campoGuia(), guia);
    await user.type(campoFactor(), factor);
    await user.click(enviar());

    const modal = await screen.findByRole("dialog");
    expect(await within(modal).findByRole("alert")).toHaveTextContent(RECHAZO_UNICO);
    expect(within(modal).queryAllByRole("listitem")).toEqual([]);
    expect(within(modal).queryByText(/Guía/)).not.toBeInTheDocument();
  });

  it("el rechazo por demasiados intentos lleva su texto propio y NO menciona la guía", async () => {
    consultarMock.mockResolvedValue({ estado: "demasiados_intentos" });
    const user = await abrirDesdeLaNav();
    await user.type(campoGuia(), "4321");
    await user.type(campoFactor(), "8899");
    await user.click(enviar());

    const alerta = await within(await screen.findByRole("dialog")).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Demasiadas consultas seguidas. Espera unos minutos y vuelve a intentarlo.",
    );
    expect(alerta.textContent ?? "").not.toContain("4321");
    expect(alerta.textContent).not.toBe(RECHAZO_UNICO);
    expect(within(dialogo()).queryAllByRole("listitem")).toEqual([]);
  });
});

describe("R29 — el modal NO gira con el tema", () => {
  it("con `.dark` en html el diálogo conserva la paleta clara", async () => {
    // El riesgo concreto de esta feature: el popup se PORTALEA fuera del subárbol
    // `tema-claro` de la landing (`app/page.tsx`), así que allí ya no hereda nada y el
    // `.dark` de la feature 211 lo alcanzaría. La defensa es el `tema-claro` explícito del
    // `DialogContent`, y esto es lo que se pone rojo si alguien lo quita.
    document.documentElement.classList.add("dark");
    await abrirDesdeLaNav();

    const modal = dialogo();
    expect(modal.className).toContain("tema-claro");
    // Y ninguna clase de lo que ESTA feature pinta pide la variante oscura. El botón de
    // cerrar de la primitiva queda fuera del barrido a propósito: es del `Dialog`
    // compartido y sus `dark:` son de `hover`/`aria-invalid` sobre tokens que
    // `tema-claro` ya fija. Lo que aquí se vigila es que el modal no traiga variantes
    // propias — que es lo que `tema-claro` NO apagaría.
    const propios = Array.from(modal.querySelectorAll("*")).filter(
      (nodo) => nodo.closest("[data-slot=\"dialog-close\"]") === null,
    );
    expect(propios.length, "el barrido se quedó sin nodos que mirar").toBeGreaterThan(10);
    for (const nodo of [modal, ...propios]) {
      expect(nodo.getAttribute("class") ?? "", `${nodo.tagName} pide variante dark:`).not.toContain(
        "dark:",
      );
    }
  });
});

describe("R30 — el resultado muere al cerrar", () => {
  it("al cerrar y reabrir, el formulario vuelve vacío", async () => {
    const user = await abrirDesdeLaNav();
    await consultar(user);
    expect(
      await within(await screen.findByRole("dialog")).findByText(/Guía 4321/),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(disparador());
    const reabierto = await screen.findByRole("dialog");

    expect((campoGuia() as HTMLInputElement).value).toBe("");
    expect((campoFactor() as HTMLInputElement).value).toBe("");
    expect(within(reabierto).queryByText(/Guía/)).not.toBeInTheDocument();
    expect(within(reabierto).queryAllByRole("listitem")).toEqual([]);
    expect(within(reabierto).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("nada del resultado sobrevive en la URL ni en el almacenamiento del navegador", async () => {
    const user = await abrirDesdeLaNav();
    await consultar(user);
    await within(await screen.findByRole("dialog")).findByText(/Guía 4321/);

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("R31 — el diálogo es accesible y operable con teclado", () => {
  it("tiene nombre accesible, se cierra con Esc y sus campos se localizan por etiqueta", async () => {
    const user = await abrirDesdeLaNav();

    expect(screen.getByRole("dialog", { name: "Rastrear envío" })).toBeInTheDocument();
    // Cada campo se localiza POR SU ETIQUETA: sin `label`+`htmlFor` esto no encuentra nada.
    expect(campoGuia()).toBeInTheDocument();
    expect(campoFactor()).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("se puede recorrer y enviar con el teclado, sin ratón", async () => {
    const user = await abrirDesdeLaNav();

    await user.click(campoGuia());
    await user.keyboard("4321");
    await user.tab();
    await user.keyboard("8899{Enter}");

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
    expect(consultarMock).toHaveBeenCalledWith({ numGuia: "4321", factor: "8899" });
  });
});
