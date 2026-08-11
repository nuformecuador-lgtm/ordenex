// @vitest-environment jsdom
//
// `components/shared/PriceLabel` — el test propio que NO tenia. `grep -rln
// "PriceLabel" tests` no devolvia nada: un componente compartido que pinta dinero
// en cinco columnas de `/ordenes` y `/recepcion-satelite`, sin una sola asercion
// encima. Su unica red eran los tests de los listados, que comprueban las
// CABECERAS de esas columnas y no lo que sale en la celda.
//
// Se escribe con la migracion de la feature 201 (tanda D) porque migrarlo cambia
// TRES cosas visibles a la vez —separador de miles, espacio tras el simbolo y
// ceros finales— y ninguna de las tres estaba medida.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PriceLabel } from "@/components/shared/PriceLabel";
import { monedaConfig, SIN_MONTO, SIN_MONTO_RAYA } from "@/lib/config/moneda";

afterEach(() => {
  cleanup();
});

/** El unico nodo que pinta el componente. */
function etiqueta(): HTMLElement {
  const nodo = document.querySelector("span");
  if (nodo === null) throw new Error("PriceLabel no pinto ningun <span>");
  return nodo as HTMLElement;
}

describe("PriceLabel — el formato de la app (feature 201)", () => {
  it("un entero se pinta con dos decimales, no pelado", () => {
    // Antes `minimumFractionDigits: 0` se comia los ceros y la columna quedaba
    // con la coma a distinta altura en cada fila.
    render(<PriceLabel value={1234} />);
    expect(screen.getByText("₡1.234,00")).toBeInTheDocument();
  });

  it("los decimales se pintan completos, incluido el cero final", () => {
    render(<PriceLabel value={1234.5} />);
    expect(screen.getByText("₡1.234,50")).toBeInTheDocument();
  });

  it("no recorta el segundo decimal", () => {
    render(<PriceLabel value={13331832.72} />);
    expect(screen.getByText("₡13.331.832,72")).toBeInTheDocument();
  });

  it("agrupa los miles de tres en tres, con PUNTO", () => {
    // La mutacion que este caso caza: quitar la agrupacion (`₡13331832,72`).
    render(<PriceLabel value={13331832.72} />);
    const texto = etiqueta().textContent ?? "";
    expect(texto).toBe("₡13.331.832,72");
    expect(texto.split(".")).toHaveLength(3);
    // Y el separador no se cuela delante del primer grupo (".999").
    expect(texto).not.toMatch(/^₡\./);
  });

  it("con miles justos tampoco cuela un separador de mas", () => {
    render(<PriceLabel value={1000} />);
    expect(screen.getByText("₡1.000,00")).toBeInTheDocument();
  });

  it("acepta el valor como STRING", () => {
    render(<PriceLabel value="4500.5" />);
    expect(screen.getByText("₡4.500,50")).toBeInTheDocument();
  });

  it("acepta el valor como NUMBER", () => {
    render(<PriceLabel value={4500.5} />);
    expect(screen.getByText("₡4.500,50")).toBeInTheDocument();
  });

  it("un negativo lleva el signo DELANTE del simbolo", () => {
    render(<PriceLabel value={-1234.5} />);
    expect(screen.getByText("-₡1.234,50")).toBeInTheDocument();
    expect(etiqueta().textContent).not.toContain("₡-");
  });

  it("el simbolo va PEGADO al importe: ni espacio normal ni espacio fino", () => {
    // `Intl` con locale "es-CR" agrupaba con espacio fino y el componente ademas
    // metia un `{' '}` tras el simbolo (`₡ 1 234,5`).
    render(<PriceLabel value={13331832.72} />);
    expect(etiqueta().textContent).not.toMatch(/[\s  ]/);
  });
});

describe("PriceLabel — sin valor pinta CERO, no el marcador de ausencia", () => {
  // Es su contrato desde que existe y sus consumidores dependen de el: en
  // `/ordenes`, una tienda sin tarifa activa tiene flete CERO, no flete
  // desconocido. Migrarlo al helper compartido no podia convertir eso en un "—".
  const AUSENTES: ReadonlyArray<readonly [string, string | number | null | undefined]> = [
    ["sin prop", undefined],
    ["null", null],
    ["cadena vacia", ""],
    ["cadena en blanco", "   "],
    ["texto no numerico", "sin tarifa"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(AUSENTES)("%s se pinta como cero", (_caso, valor) => {
    render(<PriceLabel value={valor} />);
    expect(screen.getByText("₡0,00")).toBeInTheDocument();
  });

  it("no pinta NINGUNO de los dos marcadores de «sin importe»", () => {
    // Los dos que el resto de la app usa para "no hay importe": el guion corto de
    // `formatMonto` y la raya larga de las tarjetas. Aqui ninguno vale.
    render(<PriceLabel value={null} />);
    const texto = (etiqueta().textContent ?? "").trim();
    expect(texto).not.toContain(SIN_MONTO_RAYA);
    expect(texto).not.toBe(SIN_MONTO);
    expect(texto).toMatch(/\d/);
  });

  it("el cero explicito se pinta igual que el valor ausente", () => {
    const { unmount } = render(<PriceLabel value={0} />);
    const conCero = etiqueta().textContent;
    unmount();
    render(<PriceLabel value={null} />);
    expect(etiqueta().textContent).toBe(conCero);
    expect(conCero).toBe("₡0,00");
  });
});

describe("PriceLabel — lo que NO cambia", () => {
  it("mantiene `tabular-nums whitespace-nowrap` (columna de dinero alineada)", () => {
    render(<PriceLabel value={1234.5} />);
    expect(etiqueta()).toHaveClass("tabular-nums");
    expect(etiqueta()).toHaveClass("whitespace-nowrap");
  });

  it("compone la className del consumidor sin perder las suyas", () => {
    render(<PriceLabel value={1234.5} className="text-right font-bold" />);
    expect(etiqueta()).toHaveClass("tabular-nums");
    expect(etiqueta()).toHaveClass("text-right");
    expect(etiqueta()).toHaveClass("font-bold");
  });

  it("el simbolo sale de configuracion, no esta escrito en el componente", () => {
    render(<PriceLabel value={1234.5} />);
    expect(etiqueta().textContent).toContain(monedaConfig.simbolo);
  });
});
