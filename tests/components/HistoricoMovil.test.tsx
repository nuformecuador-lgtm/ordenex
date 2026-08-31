// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";
import { ETIQUETA_VOLVER } from "@/app/(app)/historico/conversaciones/_components/HistoricoHilo";

import {
  AHORA,
  hilo,
  instalarObservador,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Pedido humano (2026-08-31) — el histórico EN MÓVIL.
//
// Por debajo de `md` no caben los dos paneles: apilados dejaban la lista y el hilo en media
// pantalla de teléfono cada uno, ilegibles. El recorrido pasa a ser el mismo del chat del
// mensajero (`ChatFlotante`): se entra por la lista, elegir una conversación la SUPERPONE y
// la flecha de la cabecera devuelve a la lista. La diferencia con el del mensajero es
// deliberada: aquí NO es un modal flotante, porque la barra de filtros vive fuera y encima y
// tiene que seguir siendo usable.
//
// CÓMO SE COMPRUEBA. jsdom no resuelve media queries, así que lo observable no es «se ve» sino
// QUÉ CLASES lleva cada panel: `hidden md:flex` es «oculto en móvil, visible desde md». Eso es
// exactamente lo que decide la superposición, y es lo único que este módulo controla —el
// breakpoint lo aplica el navegador—. Lo demás (que el hilo siga seleccionado al volver) sí se
// afirma por comportamiento.

const listarMensajes = vi.fn(async () => okMensajes([]));

beforeEach(() => {
  instalarObservador();
  listarMensajes.mockClear();
});

afterEach(cleanup);

function renderPantalla(listarHilos = vi.fn(async () => okHilos([hilo()]))) {
  renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{ listarHilos: listarHilos as never, listarMensajes: listarMensajes as never }}
      ahora={AHORA}
    />,
  );
}

function panelLista(): HTMLElement {
  return screen.getByRole("region", { name: "Conversaciones" });
}

function panelHilo(): HTMLElement {
  return screen.getByRole("region", { name: "Conversación" });
}

/** `true` cuando el panel está oculto en móvil y visible a partir de `md`. */
function ocultoEnMovil(panel: HTMLElement): boolean {
  return panel.classList.contains("hidden") && panel.classList.contains("md:flex");
}

describe("histórico en móvil — un panel a la vez", () => {
  it("se entra por la LISTA: el hilo vacío no ocupa media pantalla", async () => {
    renderPantalla();
    await screen.findByText("María González");

    expect(ocultoEnMovil(panelLista())).toBe(false);
    expect(ocultoEnMovil(panelHilo())).toBe(true);
  });

  it("elegir una conversación SUPERPONE el hilo y esconde la lista", async () => {
    renderPantalla();
    fireEvent.click(await screen.findByText("María González"));

    await waitFor(() => {
      expect(ocultoEnMovil(panelLista())).toBe(true);
    });
    expect(ocultoEnMovil(panelHilo())).toBe(false);
  });

  it("la cabecera del hilo trae la flecha de volver, y sólo en móvil", async () => {
    renderPantalla();
    fireEvent.click(await screen.findByText("María González"));
    await screen.findByTestId("historico-hilo-cabecera");

    const volver = screen.getByRole("button", { name: ETIQUETA_VOLVER });
    // `md:hidden`: a partir de `md` los dos paneles se ven a la vez y no hay a dónde volver.
    expect(volver.className).toContain("md:hidden");
  });

  it("volver devuelve a la lista SIN perder la conversación abierta", async () => {
    renderPantalla();
    fireEvent.click(await screen.findByText("María González"));
    // Se espera a que la cabecera REAL esté puesta antes de pulsar: mientras la primera página
    // está en vuelo la flecha vive en la barra provisional, y esa se sustituye —el nodo que
    // devolvería un `findBy` quedaría fuera del DOM y el clic no llegaría a React—.
    await screen.findByTestId("historico-hilo-cabecera");

    fireEvent.click(screen.getByRole("button", { name: ETIQUETA_VOLVER }));

    await waitFor(() => {
      expect(ocultoEnMovil(panelLista())).toBe(false);
    });
    expect(ocultoEnMovil(panelHilo())).toBe(true);
    // La fila sigue marcada como la que se está leyendo: volver no deselecciona, sólo cambia
    // qué panel se mira. En `md` el hilo nunca dejó de verse.
    const lista = screen.getByRole("list", { name: "Conversaciones del histórico" });
    const fila = within(lista).getAllByRole("listitem")[0];
    expect(within(fila).getByRole("button")).toHaveAttribute("aria-current", "true");
  });
});
