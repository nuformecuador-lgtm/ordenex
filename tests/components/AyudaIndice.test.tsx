// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AyudaIndice } from "@/app/(app)/ayuda/_components/AyudaIndice";
import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import { documentosQuePuedeLeer } from "@/lib/ayuda/documento";
import type { RolValue } from "@prisma/client";

// ⭑ FICHA 433 — EL ÍNDICE: la columna de la izquierda y su buscador, montados de verdad.
//
// Los tests de `acotamiento-por-rol` afirman la REGLA sobre los datos. Éste afirma lo que la
// persona VE: que los enlaces están, que el buscador filtra lo que se pinta y que lo que el
// rol no puede leer no aparece por ningún camino de la interfaz.

let rutaActual = "/ayuda";
vi.mock("next/navigation", () => ({
  usePathname: () => rutaActual,
}));

const resumenes = await leerResumenesAyuda();

/**
 * ⭑ FICHA 435 — se le pasa lo que le pasa el layout: `documentosQuePuedeLeer`, el predicado
 * de LECTURA. No es cosmético: montarlo con el estricto sería probar una lista que la
 * aplicación ya no le entrega a la oficina.
 */
function montar(rol: RolValue) {
  return render(<AyudaIndice documentos={documentosQuePuedeLeer(resumenes, rol)} />);
}

const enlaces = () =>
  screen.getAllByRole("link").map((a) => a.textContent?.trim() ?? "");

beforeEach(() => {
  rutaActual = "/ayuda";
});

describe("R14 — el índice pinta los documentos del rol, agrupados", () => {
  it("el mensajero ve sus cinco pantallas y los grupos a los que pertenecen", () => {
    montar("mensajero");
    const indice = screen.getByRole("navigation", { name: "Índice de la ayuda" });
    expect(within(indice).getByRole("link", { name: "Reparto" })).toHaveAttribute(
      "href",
      "/ayuda/mensajero/reparto",
    );
    expect(within(indice).getByText("Mensajeros")).toBeInTheDocument();
    expect(within(indice).getByText("Sin iniciar sesión")).toBeInTheDocument();
  });

  it("y NO pinta ni un enlace a la ayuda de Wallet", () => {
    montar("mensajero");
    for (const titulo of [
      "Wallet · Caja",
      "Wallet · Mensajeros",
      "Wallet · Satélites",
      "Wallet · Tiendas",
    ]) {
      expect(screen.queryByRole("link", { name: titulo })).toBeNull();
    }
    // Contraprueba: para el maestro SÍ están. Sin esto, el caso pasaría también con un índice
    // que no pinta nada.
    montar("maestro");
    expect(screen.getByRole("link", { name: "Wallet · Caja" })).toBeInTheDocument();
  });

  it("marca el documento abierto con aria-current, no sólo con un color", () => {
    rutaActual = "/ayuda/mensajero/reparto";
    montar("mensajero");
    expect(screen.getByRole("link", { name: "Reparto" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Ranking" })).not.toHaveAttribute("aria-current");
  });
});

describe("R15 — el buscador filtra lo que se VE", () => {
  it("escribir «cierre» deja el del mensajero y se lleva el resto", async () => {
    const usuario = userEvent.setup();
    montar("mensajero");
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar en la ayuda" }), "cierre");

    expect(enlaces()).toEqual(["Cierre del día"]);
    expect(screen.queryByRole("link", { name: "Reparto" })).toBeNull();
  });

  it("sin tildes encuentra igual: en la calle nadie las escribe", async () => {
    const usuario = userEvent.setup();
    montar("mensajero");
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar en la ayuda" }), "recoleccion");

    expect(enlaces()).toEqual(["Recolección"]);
  });

  it("⚠️ un mensajero que busca «wallet» NO encuentra nada, y se le dice", async () => {
    const usuario = userEvent.setup();
    montar("mensajero");
    await usuario.type(screen.getByRole("searchbox", { name: "Buscar en la ayuda" }), "wallet");

    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(
      screen.getByText(/No hay ningún documento que se llame así/),
    ).toBeInTheDocument();
  });

  it("borrar la búsqueda devuelve la lista entera", async () => {
    const usuario = userEvent.setup();
    montar("mensajero");
    const caja = screen.getByRole("searchbox", { name: "Buscar en la ayuda" });
    await usuario.type(caja, "cierre");
    expect(enlaces()).toHaveLength(1);
    await usuario.clear(caja);
    expect(enlaces()).toHaveLength(8);
  });
});
