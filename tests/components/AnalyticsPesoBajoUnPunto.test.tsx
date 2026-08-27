// @vitest-environment jsdom
//
// EL DONUT Y EL RANKING ROTULANDO UNA CATEGORÍA QUE NO LLEGA AL 1 % (feature 291).
//
// La 290 arregló `GraficaReparto` y dejó vivo el mismo defecto en las otras dos gráficas que
// escriben pesos: ambas formateaban la FRACCIÓN REDONDEADA, así que una categoría con valor 1
// sobre 233 se rotulaba «0 %» pegada a su propia cifra — un cero que niega el dato de al lado.
//
// LO QUE AQUÍ **NO** SE MIDE, Y ES DELIBERADO: el dibujo. En estas dos gráficas el defecto era
// SOLO la etiqueta. El anillo lo pinta recharts con el valor CRUDO y la barra del ranking mide
// `valor / mayor`, así que ninguna porción desaparecía por el redondeo y no hay astilla que
// comprobar (en `GraficaReparto` sí la hay, y su test la afirma).
//
// Los datos son los EXACTOS de producción del 2026-08-27: 233 órdenes en `[1, 0, 0, 1, 0, 231]`.
// Las dos categorías de valor 1 pesan 0,429 % cada una y solo sobra UN punto que repartir, así
// que por puntos una salía «1 %» y su gemela «0 %»: dos etiquetas distintas para el mismo dato.
//
// ─── POR QUÉ EL DONUT SE AFIRMA SOBRE UN DOBLE DEL LIENZO (R41) ─────────────────────────────
//
// Su leyenda visible vive DENTRO de recharts, que en jsdom renderiza vacío: interrogar ese SVG
// daría verde siempre (design.md §6.2.1). Lo que sí es afirmable —y es nuestro código— es el
// array de pesos que la gráfica LE PASA al lienzo, el mismo que indexa la leyenda lateral y el
// texto sobre la porción. El doble es LOCAL, como manda §6.3, y solo captura esa prop.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { GraficaRanking } from "@/components/private/analytics/GraficaRanking";

const capturado = vi.hoisted(() => ({ pesos: undefined as readonly string[] | undefined }));

vi.mock("@/components/private/analytics/lienzo/DonutLienzo", () => ({
  default: ({ pesos }: { pesos?: readonly string[] }) => {
    capturado.pesos = pesos;
    return <div data-testid="lienzo-donut" />;
  },
}));

const VACIO = { titulo: "Sin datos en el rango", descripcion: "Prueba con otro rango" };
const TITULO = "Detalle gestión";

const CATEGORIAS = [
  "Entregadas",
  "Devueltas",
  "Canceladas",
  "Reprogramadas",
  "Perdidas",
  "Sin gestionar",
] as const;
const VALORES = [1, 0, 0, 1, 0, 231];

/** Índices de las dos categorías de valor 1, y el de una que vale cero DE VERDAD. */
const CON_VALOR_MINUSCULO = [0, 3];
const CERO_DE_VERDAD = 1;

const SERIE = {
  id: "detalle_gestion",
  etiqueta: TITULO,
  puntos: CATEGORIAS.map((categoria, indice) => ({ categoria, valor: VALORES[indice] ?? 0 })),
};

/**
 * Quita los espacios que `Intl` mete entre la cifra y el `%`, que cambian con el locale
 * configurado (`MONEDA_LOCALE`) y a veces son un espacio FINO o duro, invisibles en el diff.
 * `\s` de JavaScript ya los cubre todos, así que no hace falta enumerarlos aquí.
 *
 * Se normaliza el espacio y NADA MÁS: el «<», el «1» y el «%» se afirman tal cual, porque son
 * justo lo que esta feature promete. Comparar contra `formatearValor` sería comparar el texto
 * con la función que lo genera, y eso sale verde pase lo que pase.
 */
function sinEspacios(texto: string): string {
  return texto.replace(/\s/g, "");
}

/** La entrada de la alternativa textual (`sr-only`) de una categoría, ya normalizada. */
function textoAccesible(categoria: string): string {
  const lista = screen.getByRole("list", { name: TITULO });
  const fila = Array.from(lista.querySelectorAll("li")).find((nodo) =>
    nodo.textContent?.includes(`, ${categoria}: `),
  );
  expect(fila, `no hay entrada textual para ${categoria}`).toBeDefined();
  return sinEspacios(fila?.textContent ?? "");
}

afterEach(() => {
  cleanup();
  capturado.pesos = undefined;
});

describe("GraficaDonut con una categoría por debajo del 1 % (feature 291)", () => {
  async function pintar() {
    render(
      <GraficaDonut
        titulo={TITULO}
        series={[SERIE]}
        unidad="conteo"
        vacio={VACIO}
        mostrarPorcentaje
      />,
    );
    await screen.findByTestId("lienzo-donut");
    return capturado.pesos ?? [];
  }

  it("la categoría de valor 1 se rotula «<1 %» y no «0 %»", async () => {
    const pesos = await pintar();

    for (const indice of CON_VALOR_MINUSCULO) {
      expect(sinEspacios(pesos[indice] ?? ""), `${CATEGORIAS[indice]}`).toBe("<1%");
    }
  });

  // Un cero de verdad y una parte demasiado pequeña para el redondeo son HECHOS DISTINTOS: si el
  // «<» se le pusiera a todo lo que redondea a cero, la gráfica diría que hubo devoluciones.
  it("la categoría que vale cero de verdad sigue diciendo «0 %»", async () => {
    const pesos = await pintar();

    expect(sinEspacios(pesos[CERO_DE_VERDAD] ?? "")).toBe("0%");
  });

  it("las dos categorías con el mismo valor dicen lo mismo, y el mayor conserva su 99 %", async () => {
    const pesos = await pintar();

    expect(pesos[0]).toBe(pesos[3]);
    expect(sinEspacios(pesos[5] ?? "")).toBe("99%");
  });

  // El array que se afirma arriba es el que indexa la leyenda del anillo; éste es el que oye un
  // lector de pantalla. Si se calcularan por separado podrían discrepar sin que nada avisara.
  it("la alternativa textual dice el mismo peso que la leyenda del anillo", async () => {
    const pesos = await pintar();

    for (const [indice, categoria] of CATEGORIAS.entries()) {
      expect(textoAccesible(categoria)).toContain(`(${sinEspacios(pesos[indice] ?? "")})`);
    }
    expect(textoAccesible("Reprogramadas")).toBe(sinEspacios(`${TITULO}, Reprogramadas: 1 (<1 %)`));
    expect(textoAccesible("Devueltas")).toBe(sinEspacios(`${TITULO}, Devueltas: 0 (0 %)`));
  });
});

describe("GraficaRanking con una categoría por debajo del 1 % (feature 291)", () => {
  function pintar() {
    return render(<GraficaRanking titulo={TITULO} series={[SERIE]} unidad="conteo" vacio={VACIO} />);
  }

  /** El peso escrito en la fila visible: la última celda de esa fila, ya normalizada. */
  function pesoEnFila(container: HTMLElement, categoria: string): string {
    const fila = Array.from(container.querySelectorAll("li")).find((nodo) =>
      nodo.textContent?.startsWith(categoria),
    );
    expect(fila, `no hay fila visible para ${categoria}`).toBeDefined();
    return sinEspacios(fila?.lastElementChild?.textContent ?? "");
  }

  it("la categoría de valor 1 se rotula «<1 %» y no «0 %»", () => {
    const { container } = pintar();

    for (const indice of CON_VALOR_MINUSCULO) {
      const categoria = CATEGORIAS[indice] ?? "";
      expect(pesoEnFila(container, categoria), categoria).toBe("1(<1%)");
    }
  });

  it("la categoría que vale cero de verdad sigue diciendo «0 %»", () => {
    const { container } = pintar();

    expect(pesoEnFila(container, CATEGORIAS[CERO_DE_VERDAD] ?? "")).toBe("0(0%)");
  });

  it("las dos categorías con el mismo valor dicen lo mismo, y el mayor conserva su 99 %", () => {
    const { container } = pintar();

    expect(pesoEnFila(container, "Entregadas")).toBe(pesoEnFila(container, "Reprogramadas"));
    expect(pesoEnFila(container, "Sin gestionar")).toBe("231(99%)");
  });

  it("la alternativa textual dice el mismo peso que la fila visible", () => {
    const { container } = pintar();

    for (const categoria of CATEGORIAS) {
      expect(textoAccesible(categoria)).toBe(
        sinEspacios(`${TITULO}, ${categoria}: ${pesoEnFila(container, categoria)}`),
      );
    }
    expect(textoAccesible("Reprogramadas")).toBe(sinEspacios(`${TITULO}, Reprogramadas: 1 (<1 %)`));
  });
});
