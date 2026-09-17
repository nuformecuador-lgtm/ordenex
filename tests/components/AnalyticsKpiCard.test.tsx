// @vitest-environment jsdom
//
// KpiCard del paquete de analitica (feature 130): R12-R15.
// El valor esperado se deriva de `lib/config/moneda.ts`, nunca de un literal
// "₡3.500,00" escrito a mano: si manana cambia la configuracion, el test debe
// seguir midiendo el requisito y no la moneda de hoy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { KpiCard } from "@/components/private/analytics/KpiCard";
import { formatearValor } from "@/components/private/analytics/formato";
import { CLASES_CIFRA } from "@/components/private/analytics/jerarquia";
import { formatMonto, SIN_MONTO } from "@/lib/config/moneda";

/**
 * El doble de `react-countup` del setup global se sustituye por otro que hace LO MISMO
 * —renderizar `formattingFn(end)`, de ahi que ningun caso de este archivo cambie— y ademas
 * GUARDA las props. Hace falta para el caso de la RESOLUCION de la cuenta (2026-08-19): lo
 * que hay que afirmar es el `decimals` con el que se monta el contador, y el doble del setup
 * lo ignora.
 */
const { propsDeCountUp } = vi.hoisted(() => ({
  propsDeCountUp: [] as { end: number; decimals?: number; formattingFn?: (n: number) => string }[],
}));

vi.mock("react-countup", () => ({
  default: (props: { end: number; decimals?: number; formattingFn?: (n: number) => string }) => {
    propsDeCountUp.push(props);
    return props.formattingFn ? props.formattingFn(props.end) : String(props.end);
  },
}));

const VARIACION_TEXTO = { sube: "Sube", baja: "Baja", igual: "Sin cambio" };

/**
 * `Intl` separa los miles con ESPACIO DURO (U+00A0) en `es-CR`, y testing-library
 * normaliza los espacios del DOM pero NO los del texto esperado. Sin esto, el test
 * fallaria por un caracter invisible y no por el requisito.
 */
const norm = (texto: string) => texto.replace(/\s/g, " ");

beforeEach(() => {
  propsDeCountUp.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("KpiCard (R12-R15)", () => {
  it.each(["conteo", "porcentaje", "moneda", "segundos"] as const)(
    "muestra etiqueta y valor formateado por unidad: %s",
    (unidad) => {
      render(<KpiCard etiqueta="Entregas" valor={3500} unidad={unidad} />);

      expect(screen.getByText("Entregas")).toBeInTheDocument();
      expect(screen.getByText(norm(formatearValor(3500, unidad)))).toBeInTheDocument();
    },
  );

  it("el valor en moneda usa el formato configurado, sin simbolo hardcodeado", () => {
    render(<KpiCard etiqueta="Ingresos" valor={3500} unidad="moneda" />);

    // Feature 201: el aspecto del dinero lo define `formatMonto` (punto para los
    // miles, coma para los decimales) y ya no `Intl` con el locale, que agrupaba
    // con espacio fino. El literal del formato se mide en
    // `tests/unit/config/moneda-formato.test.ts`; aqui lo que se afirma es que
    // la tarjeta no escribe ni el simbolo ni el formato por su cuenta.
    expect(screen.getByText(norm(formatMonto(3500)))).toBeInTheDocument();
  });

  it("un valor nulo muestra el marcador de dato ausente y no cero", () => {
    render(<KpiCard etiqueta="Entregas" valor={null} unidad="conteo" />);

    expect(screen.getByText(SIN_MONTO)).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("la variacion dice su signo con texto, no solo con color", () => {
    const { rerender } = render(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 3, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Sube 3 vs\. periodo anterior/)).toBeInTheDocument();

    rerender(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: -3, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Baja 3 vs\. periodo anterior/)).toBeInTheDocument();

    rerender(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 0, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Sin cambio 0 vs\. periodo anterior/)).toBeInTheDocument();
  });

  it("la variacion usa los tokens semanticos -strong, no la escala cruda", () => {
    const { container } = render(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 3, etiqueta: "vs. anterior", texto: VARIACION_TEXTO }}
      />,
    );

    expect(container.querySelector(".text-success-strong")).not.toBeNull();
  });

  it("hereda los estados de carga y error con la misma precedencia que las graficas", () => {
    const { rerender } = render(
      <KpiCard etiqueta="Entregas" valor={10} unidad="conteo" cargando />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("10")).toBeNull();

    rerender(<KpiCard etiqueta="Entregas" valor={10} unidad="conteo" cargando error="Falla" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falla");
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ⚠ ESTE CASO DECIA LO CONTRARIO hasta el 2026-08-19 («no anima»). La cifra AHORA se cuenta
  // con `react-countup` (pedido humano), que es lo que la cabecera de `KpiCard` dejaba abierto.
  // Lo que se conserva intacto —y es lo que este caso vigila— es que animar no mete ninguna
  // clase de animacion CSS en la tarjeta: la cuenta la lleva JavaScript, y una clase
  // `animate-*` aqui seria un segundo movimiento que nadie pidio y que `prefers-reduced-motion`
  // tendria que apagar por otro camino.
  it("anima la cifra por JS, sin clases de animacion CSS en la tarjeta", () => {
    const { container } = render(<KpiCard etiqueta="Entregas" valor={10} unidad="conteo" />);

    const clases = Array.from(container.querySelectorAll("*"))
      .flatMap((nodo) => Array.from(nodo.classList))
      .join(" ");
    expect(clases).not.toMatch(/\banimate-/);
    // El doble global de `react-countup` (`tests/setup/jest-dom.ts`) pinta el valor FINAL ya
    // formateado, asi que el fotograma que se ve aqui es el mismo texto de siempre.
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  // Pedido humano (2026-08-19): «que la cuenta se vea subir desde 0, como en los KPI del
  // mensajero y la landing». Sin `arrancarEnCero`, react-countup emite el valor FINAL en el
  // HTML inicial y solo baja a `start` al hidratar: la tarjeta ensena la cifra, salta a 0 y
  // sube — un parpadeo, no una cuenta. Se mide sobre `renderToStaticMarkup` y no sobre
  // `render` por lo mismo que en `cifras-publicas.test.tsx`: en jsdom el contador ya llego a
  // su valor final dentro del `act()` de Testing Library, asi que ahi el estado inicial es
  // INOBSERVABLE. Donde este 0 importa es en el HTML que se manda al navegador.
  it("el HTML de SERVIDOR sale en 0: la cuenta sube desde ahi, sin flash del valor final", () => {
    const html = renderToStaticMarkup(
      <KpiCard etiqueta="Entregas" valor={1234} unidad="conteo" />,
    );

    expect(html).toContain(">0<");
    expect(html).not.toContain(norm(formatearValor(1234, "conteo")));
  });

  // 2026-08-19 — «los KPI de Movimiento de las ordenes no cuentan desde 0». Montaban ya el
  // contador de `react-countup`, pero los de PORCENTAJE no se veian contar: su valor llega
  // como FRACCION (0-1) y countup.js redondea el valor de cada fotograma a `decimals` antes
  // de formatearlo, asi que con los 0 de siempre todos los fotogramas valian 0 y la tarjeta
  // saltaba del «0 %» a la cifra final. Se mide el `decimals` que recibe el contador y no un
  // fotograma intermedio: en jsdom el doble pinta el valor final y esa cuenta es inobservable.
  it("el porcentaje se cuenta con resolucion de fraccion, no en pasos de entero", () => {
    render(<KpiCard etiqueta="Efectividad" valor={0.842} unidad="porcentaje" />);

    const props = propsDeCountUp.at(-1);
    expect(props?.decimals).toBeGreaterThanOrEqual(3);
  });

  it("las unidades de magnitud grande siguen contando en enteros", () => {
    // El conteo no necesita decimales y pedirlos seria precision que el texto no muestra.
    render(<KpiCard etiqueta="Entregas" valor={1234} unidad="conteo" />);

    expect(propsDeCountUp.at(-1)?.decimals).toBe(0);
  });

  // El dato AUSENTE no se cuenta: contar de 0 hasta «no hay dato» no significa nada, y un cero
  // subiendo se leeria como una medicion donde lo que hay es un hueco (R11/R14).
  it("el dato ausente se pinta sin contador", () => {
    render(<KpiCard etiqueta="Entregas" valor={null} unidad="conteo" />);

    expect(screen.getByText(SIN_MONTO)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* FICHA 441 — la JERARQUIA es una prop del contrato, no estilo suelto         */
/* -------------------------------------------------------------------------- */

/**
 * El defecto que la ficha 441 midio en `/analitica`: cinco tarjetas con el MISMO peso visual,
 * de modo que «17,4 % de efectividad» se leia igual que «En proceso 37». La causa estaba en
 * este contrato —`KpiCard` no tenia ninguna propiedad de enfasis— y por eso la reparacion es
 * una prop y no un `className` en el llamador.
 *
 * ⚠ LO QUE MAS IMPORTA DE ESTE BLOQUE es el PRIMER caso: el default no cambia. Las otras cuatro
 * pantallas que montan `KpiCard` (tablero financiero, KPIs financieros, paneles operativos y el
 * ciclo de vida antes de bajar de rango) no pasan `jerarquia`, y tienen que pintarse exactamente
 * igual que antes de esta ficha.
 */
describe("jerarquia (ficha 441)", () => {
  /** El parrafo de la cifra: el que lleva el tamaño de la tarjeta. */
  function cifraDe(texto: string): HTMLElement {
    const nodo = screen.getByText(texto).closest("p");
    if (nodo === null) throw new Error("la cifra no esta dentro de un parrafo");
    return nodo;
  }

  it("sin pedir nada, la tarjeta se pinta como antes de la ficha", () => {
    render(<KpiCard etiqueta="Entregas" valor={1234} unidad="conteo" />);

    // `text-2xl` es literalmente lo que `KpiCard` escribia antes de que existiera la prop: es
    // el contrato con las pantallas que no la pasan, no una preferencia de hoy.
    expect(cifraDe(norm(formatearValor(1234, "conteo"))).classList.contains("text-2xl")).toBe(true);
    expect(screen.getByText("Entregas").classList.contains("text-sm")).toBe(true);
  });

  it("«apoyo» baja de rango la cifra Y el rotulo", () => {
    render(<KpiCard etiqueta="Entregas" valor={1234} unidad="conteo" jerarquia="apoyo" />);

    const cifra = cifraDe(norm(formatearValor(1234, "conteo")));
    expect(cifra.classList.contains("text-2xl")).toBe(false);
    expect(cifra.classList.contains("text-[22px]")).toBe(true);
    expect(screen.getByText("Entregas").classList.contains("text-xs")).toBe(true);
  });

  // Si alguien vaciara el catalogo o pusiera los tres rangos iguales, «bajar de rango» dejaria
  // de significar nada y las tarjetas volverian a pesar lo mismo — sin que nada se pusiera rojo.
  it("los tres rangos son tres tamaños distintos, no tres nombres del mismo", () => {
    const tamanos = [CLASES_CIFRA.heroe, CLASES_CIFRA.normal, CLASES_CIFRA.apoyo];

    expect(new Set(tamanos).size).toBe(3);
    for (const clases of tamanos) expect(clases.trim()).not.toBe("");
  });
});
