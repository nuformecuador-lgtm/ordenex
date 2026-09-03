// @vitest-environment jsdom
//
// LA BARRA AL 100 % CON UNA CATEGORÍA DIMINUTA (feature 290).
//
// Aquí SÍ se pueden contar los rectángulos, y no contradice R41: `GraficaReparto` no dibuja
// con recharts —son `div`s con anchura porcentual en un `style` inline— así que en jsdom se
// montan de verdad y su anchura es un dato afirmable. Lo prohibido es interrogar el SVG de
// recharts, que en jsdom renderiza vacío y deja cualquier aserción siempre en verde.
//
// El caso es el EXACTO de producción del 2026-08-27: 233 órdenes en `[1, 0, 0, 1, 0, 231]`.
// «Reprogramadas 1» salía con anchura 0 % —la franja no existía— y con un «(0 %)» en la
// leyenda, mientras «Entregadas», con el MISMO valor, salía con su franja y su «(1 %)».
//
// ─── Y LO QUE AÑADE LA FICHA 364 ────────────────────────────────────────────────────────────
//
// El número escrito pasó a ser la RAZÓN EXACTA —la misma que formatea el KPI «Efectividad de
// entrega» de la misma pantalla— en vez de la cuota del resto mayor: 1 de 233 ya no dice
// «<1 %» sino «0,4 %», y 231 de 233 dice «99,1 %» en vez de «99 %». Lo que NO se movió, y aquí
// se sigue midiendo sobre los `div` de verdad, es que la BARRA mide exactamente 100 %: eso es
// geometría y sigue saliendo del resto mayor. El caso que aún necesita el «menor que» —una
// parte más pequeña que lo que el formateador sabe escribir— vive en `MINUSCULO`.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GraficaReparto } from "@/components/private/analytics/GraficaReparto";

const VACIO = { titulo: "Sin datos en el rango", descripcion: "Prueba con otro rango" };

const CATEGORIAS = [
  "Entregadas",
  "Devueltas",
  "Canceladas",
  "Reprogramadas",
  "Perdidas",
  "Sin gestionar",
] as const;
const VALORES = [1, 0, 0, 1, 0, 231];

/** FICHA 364 — el reparto donde el «<» sí hace falta: 1 de 3.001 es 0,033 %, que no cabe en un decimal. */
const MINUSCULO = [1, 0, 0, 1, 0, 2999];

const serieDe = (valores: readonly number[]) => ({
  id: "detalle_gestion",
  etiqueta: "Detalle gestión",
  puntos: CATEGORIAS.map((categoria, indice) => ({ categoria, valor: valores[indice] ?? 0 })),
});

const SERIE = serieDe(VALORES);

function pintar(valores: readonly number[] = VALORES) {
  return render(
    <GraficaReparto
      titulo="Detalle gestión"
      series={[serieDe(valores)]}
      unidad="conteo"
      vacio={VACIO}
    />,
  );
}

/** Las franjas de la barra: los hijos del rectángulo que la clase de animación identifica. */
function franjas(container: HTMLElement): HTMLElement[] {
  const barra = container.querySelector(".grafica-barra-crece");
  return Array.from(barra?.children ?? []).filter(
    (nodo): nodo is HTMLElement => nodo instanceof HTMLElement,
  );
}

/** La anchura de una franja en PUNTOS, leída del `style` inline tal cual la pinta el navegador. */
function anchoEnPuntos(franja: HTMLElement): number {
  const ancho = franja.style.width;
  expect(ancho, "la franja no declara anchura").toMatch(/%$/);
  return Number.parseFloat(ancho);
}

/** El texto del peso en la leyenda visible (la última celda de la fila de esa categoría). */
function pesoEnLeyenda(container: HTMLElement, categoria: string): string {
  const fila = Array.from(container.querySelectorAll("li")).find((nodo) =>
    nodo.textContent?.startsWith(categoria),
  );
  expect(fila, `no hay fila de leyenda para ${categoria}`).toBeDefined();
  return fila?.lastElementChild?.textContent ?? "";
}

afterEach(() => {
  cleanup();
});

describe("GraficaReparto con una categoría por debajo del 1 % (feature 290)", () => {
  it("pinta una franja por categoría, también las que valen 1", () => {
    const { container } = pintar();

    expect(franjas(container)).toHaveLength(CATEGORIAS.length);
  });

  it("«Reprogramadas» tiene franja: ancho mayor que cero", () => {
    const { container } = pintar();
    const reprogramadas = franjas(container)[CATEGORIAS.indexOf("Reprogramadas")];

    expect(reprogramadas).toBeDefined();
    expect(anchoEnPuntos(reprogramadas as HTMLElement)).toBeGreaterThan(0);
  });

  it("toda categoría con valor ocupa barra y la que vale cero no ocupa nada", () => {
    const { container } = pintar();
    const anchos = franjas(container).map(anchoEnPuntos);

    for (const [indice, valor] of VALORES.entries()) {
      const ancho = anchos[indice] ?? Number.NaN;
      if (valor > 0) expect(ancho, `${CATEGORIAS[indice]}`).toBeGreaterThan(0);
      else expect(ancho, `${CATEGORIAS[indice]}`).toBe(0);
    }
  });

  // La astilla se le cobra al mayor: si se sumara al total, `flex` encogería todas las franjas
  // para hacerla caber y el reparto entero quedaría deformado sin que nada lo avise.
  it("la barra sigue midiendo exactamente 100 %", () => {
    const { container } = pintar();
    const total = franjas(container)
      .map(anchoEnPuntos)
      .reduce((suma, ancho) => suma + ancho, 0);

    expect(total).toBeCloseTo(100, 6);
  });

  it("las dos categorías de valor 1 dicen lo mismo en la leyenda, y no «0 %»", () => {
    const { container } = pintar();
    const entregadas = pesoEnLeyenda(container, "Entregadas");

    expect(entregadas).toBe(pesoEnLeyenda(container, "Reprogramadas"));
    // FICHA 364 — su razón exacta, que con un decimal ya se puede escribir. Lo que se afirma
    // sigue siendo que no es el «0 %» que niega el dato de al lado.
    expect(entregadas.replace(/\s/g, "")).toBe("1(0,4%)");
    expect(entregadas).not.toContain("(0 %)");
    // Y la que vale cero de verdad no lleva el «menor que»: son dos hechos distintos.
    expect(pesoEnLeyenda(container, "Devueltas")).not.toContain("<");
  });

  // El caso que SIGUE necesitando el «menor que»: 1 de 3.001 se escribiría «0 %» con un decimal.
  it("una categoría más pequeña que el decimal dice «<0,1 %», no «0 %»", () => {
    const { container } = pintar(MINUSCULO);

    expect(pesoEnLeyenda(container, "Entregadas").replace(/\s/g, "")).toBe("1(<0,1%)");
    expect(pesoEnLeyenda(container, "Devueltas")).not.toContain("<");
  });

  // FICHA 364 — el segmento mayor escribe su razón exacta, y no la cuota que le dejó el reparto
  // (que es 99,2 %) ni el 99 % de puntos enteros de antes.
  it("el segmento mayor escribe su razón exacta, no su cuota", () => {
    const { container } = pintar();

    expect(pesoEnLeyenda(container, "Sin gestionar").replace(/\s/g, "")).toBe("231(99,1%)");
  });

  // La lista `sr-only` es lo que oye un lector de pantalla. Si el «<1 %» solo estuviera en la
  // leyenda visible, oiría «0 %» junto a una cifra de 1: otra cosa que la pantalla.
  it("la alternativa textual dice el mismo peso que la leyenda", () => {
    const { container } = pintar();
    const peso = pesoEnLeyenda(container, "Reprogramadas");

    expect(screen.getByText(`Detalle gestión, Reprogramadas: ${peso}`)).toBeInTheDocument();
  });
});
