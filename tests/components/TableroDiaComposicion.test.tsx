// @vitest-environment jsdom
//
// Feature 258 (F5.3) — LA BARRA APILADA de composición.
// Mapea: R66, R67, R68, R69, R70, y el riesgo §11.6 del diseño (R47/R48).
//
// La barra es el sitio donde el color más fácilmente se convierte en el ÚNICO portador del
// dato: ocho tramos de colores sin una cifra dentro. Por eso la mitad de este archivo no mide
// el dibujo sino lo que lo acompaña —el `aria-label` que enumera los ocho valores y los ocho
// `Badge` que los repiten fuera de la barra—.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";

import { ComposicionBarra } from "@/app/(app)/monitoreo/_components/ComposicionBarra";
import {
  CLAVES_CONTADOR,
  COLOR_SEGMENTO,
  etiquetaContador,
} from "@/app/(app)/monitoreo/_components/contadores";
import { MensajeroCard } from "@/app/(app)/monitoreo/_components/MensajeroCard";
import { TableroDiaTotales } from "@/app/(app)/monitoreo/_components/TableroDiaTotales";
import type {
  FilaTableroDia,
  PuntoRitmoEntregas,
  TotalesTableroDia,
} from "@/lib/types/tablero-dia";
import { componer, contraste, paleta, token } from "../fixtures/contraste";

afterEach(cleanup);

/** Los ocho sumandos suman las `asignadas`: la identidad de R3, que es lo que hace cierto R70. */
const CONTADORES: TotalesTableroDia = {
  asignadas: 20,
  entregadas: 8,
  reprogramadas: 3,
  devueltas: 2,
  rechazadas: 1,
  incidentes: 1,
  sinRecoger: 3,
  enReparto: 2,
  otros: 0,
};

const RITMO: readonly PuntoRitmoEntregas[] = [
  { hora: 0, acumulado: 0 },
  { hora: 1, acumulado: 8 },
];

const fila: FilaTableroDia = {
  mensajeroId: "m-1",
  mensajeroNombre: "Ana Rojas",
  ...CONTADORES,
};

const barra = (raiz: ParentNode = document): HTMLElement => {
  const nodo = raiz.querySelector('[data-slot="composicion-barra"]');
  if (!(nodo instanceof HTMLElement)) throw new Error("sin barra de composición");
  return nodo;
};

const segmentos = (raiz: HTMLElement): HTMLElement[] =>
  [...raiz.querySelectorAll("[data-segmento]")].filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  );

describe("Feature 258 · R66 — hay barra en la tira de totales y en cada tarjeta", () => {
  it("la tira de totales monta una", () => {
    render(<TableroDiaTotales totales={CONTADORES} ritmoEntregas={RITMO} />);
    const tira = document.querySelector('[data-slot="tablero-dia-totales"]') as HTMLElement;
    expect(barra(tira)).toBeInTheDocument();
  });

  it("cada tarjeta de mensajero monta la suya", () => {
    render(<MensajeroCard fila={fila} onSeleccionar={() => {}} />);
    const tarjeta = document.querySelector('[data-mensajero="m-1"]') as HTMLElement;
    expect(barra(tarjeta)).toBeInTheDocument();
  });
});

describe("Feature 258 · R69/R70 — el reparto", () => {
  it("los anchos de los segmentos suman el 100 % de las asignadas", () => {
    render(<ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />);

    const anchos = segmentos(barra()).map((nodo) =>
      Number.parseFloat(nodo.style.width.replace("%", "")),
    );
    const suma = anchos.reduce((total, ancho) => total + ancho, 0);
    // Con tolerancia de coma flotante y NADA más: si un segmento se quedara fuera, la suma
    // bajaría en su porcentaje entero, no en una milésima.
    expect(suma).toBeCloseTo(100, 6);
  });

  it("un contador a 0 NO pinta segmento", () => {
    render(<ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />);
    const claves = segmentos(barra()).map((n) => n.getAttribute("data-segmento"));

    // `otros` vale 0 en esta composición: no puede haber un `<span>` de ancho 0 % ensuciando
    // el DOM (y el `aria-label` sí lo dice, ver abajo).
    expect(claves).not.toContain("otros");
    expect(claves).toEqual(
      CLAVES_CONTADOR.filter((clave) => CONTADORES[clave] > 0),
    );
  });

  it("con todo a cero no hay ningún segmento, sólo la pista", () => {
    const vacio: TotalesTableroDia = {
      asignadas: 0,
      entregadas: 0,
      reprogramadas: 0,
      devueltas: 0,
      rechazadas: 0,
      incidentes: 0,
      sinRecoger: 0,
      enReparto: 0,
      otros: 0,
    };
    render(<ComposicionBarra contadores={vacio} etiqueta="Composición del día" />);
    expect(segmentos(barra())).toHaveLength(0);
  });

  it("la barra de la tarjeta y la de la tira se derivan del MISMO dato", () => {
    // Se montan con los mismos contadores y tienen que producir el mismo reparto: si cada una
    // se armara el suyo, la tarjeta y el total podrían contar historias distintas.
    const { container: tarjeta } = render(
      <ComposicionBarra contadores={CONTADORES} etiqueta="Composición de Ana Rojas" />,
    );
    const anchosTarjeta = segmentos(barra(tarjeta)).map((n) => n.style.width);
    cleanup();

    const { container: tira } = render(
      <ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />,
    );
    expect(segmentos(barra(tira)).map((n) => n.style.width)).toEqual(anchosTarjeta);
  });
});

describe("Feature 258 · R67 — cada segmento usa la clase de `COLOR_SEGMENTO`", () => {
  it("la clase de cada segmento es la del mapa, por su clave", () => {
    render(<ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />);

    for (const nodo of segmentos(barra())) {
      const clave = nodo.getAttribute("data-segmento") as keyof typeof COLOR_SEGMENTO;
      expect(nodo.className.split(/\s+/)).toContain(COLOR_SEGMENTO[clave]);
    }
  });

  it("los ocho colores salen de tokens de `globals.css`: ni un hex, ni paleta cruda", () => {
    for (const clave of CLAVES_CONTADOR) {
      const clase = COLOR_SEGMENTO[clave];
      expect(clase, `${clave} escribe un hex`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(clase, `${clave} usa una utilidad de paleta cruda`).not.toMatch(
        /\bbg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
      );
      expect(clase.startsWith("bg-"), `${clave} no es una utilidad de fondo`).toBe(true);
    }
  });
});

describe("Feature 258 · R68 — el color NO es el único portador del dato", () => {
  it("el `aria-label` de la barra enumera los OCHO valores, ceros incluidos", () => {
    render(<ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />);
    const etiqueta = barra().getAttribute("aria-label") ?? "";

    expect(etiqueta).toContain("Composición del día");
    for (const clave of CLAVES_CONTADOR) {
      expect(
        etiqueta,
        `el nombre accesible no dice ${clave}: quien escucha se queda sin ese dato`,
      ).toContain(`${etiquetaContador(clave)} ${CONTADORES[clave]}`);
    }
    // `otros` vale 0 y NO pinta segmento, pero SÍ se dice: callarlo dejaría a quien escucha
    // sin saber si el contador no existe o está a cero.
    expect(etiqueta).toContain(`${etiquetaContador("otros")} 0`);
  });

  it("la barra es un `role=\"img\"`: los segmentos no entran en el árbol accesible", () => {
    render(<ComposicionBarra contadores={CONTADORES} etiqueta="Composición del día" />);
    expect(barra().getAttribute("role")).toBe("img");
    for (const nodo of segmentos(barra())) {
      expect(nodo.textContent, "un segmento lleva texto dentro").toBe("");
    }
  });

  it("cada cifra y su etiqueta siguen legibles FUERA de la barra, en los ocho `Badge`", () => {
    render(<MensajeroCard fila={fila} onSeleccionar={() => {}} />);
    const tarjeta = document.querySelector('[data-mensajero="m-1"]') as HTMLElement;

    for (const clave of CLAVES_CONTADOR) {
      const chip = tarjeta.querySelector(`[data-contador="${clave}"]`) as HTMLElement;
      expect(chip, `falta el contador ${clave}`).not.toBeNull();
      // Fuera de la barra: el chip no puede estar dentro de ella.
      expect(barra(tarjeta).contains(chip)).toBe(false);
      expect(within(chip).getByText(String(CONTADORES[clave]))).toBeInTheDocument();
      expect(chip).toHaveTextContent(etiquetaContador(clave));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
   El riesgo §11.6 del diseño, convertido en invariante ejecutable.

   `design.md` §11.6 avisaba: los cuatro semánticos base son hexes FIJOS y la pista `bg-muted`
   GIRA con el tema; `--color-info` (#1a56db) es el único oscuro y podía fundirse con la pista
   en tema oscuro. F7.3 mandaba comprobarlo A OJO en el navegador y, si pasaba, cambiarlo por
   `bg-chart-13` (que gira). Se comprobó con la aritmética del repo —`tests/fixtures/contraste`,
   validada contra tres razones publicadas por WCAG— en vez de a ojo, porque un ojo no deja
   constancia y no vuelve a mirar en seis meses.

   MEDIDO (contraste del segmento contra la pista `--muted`):
     bg-info      →  5.61 claro · **2.34 oscuro**  ← por debajo del 3:1 de WCAG 1.4.11
     bg-chart-13  →  9.41 claro ·   8.03 oscuro
   Por eso `enReparto` va en `bg-chart-13`. Este test es lo que impide volver atrás en silencio.
   ══════════════════════════════════════════════════════════════════════════════════════════ */
describe("Feature 258 · R47/R48 — «En reparto» se separa de la pista en los DOS temas", () => {
  /** Umbral de WCAG 2.1 §1.4.11 para un objeto gráfico no textual. */
  const UMBRAL_GRAFICO = 3;

  /** El hex real del segmento de `enReparto` en cada tema, leído de `app/globals.css`. */
  function colorDelSegmento(tema: "claro" | "oscuro"): string {
    const clase = COLOR_SEGMENTO.enReparto;
    const nombre = clase.replace(/^bg-/, "");
    // Los `chart-*` GIRAN (se declaran en `:root` y en `.dark`); los semánticos base son fijos
    // y viven en `@theme` con el prefijo `--color-`.
    return nombre.startsWith("chart-") ? token(tema, nombre) : paleta(nombre);
  }

  it.each(["claro", "oscuro"] as const)("en tema %s supera el 3:1 contra `bg-muted`", (tema) => {
    const razon = contraste(colorDelSegmento(tema), token(tema, "muted"));
    expect(
      razon,
      `el segmento de «En reparto» (${COLOR_SEGMENTO.enReparto}) da ${razon.toFixed(2)}:1 ` +
        `sobre la pista en tema ${tema}: se funde con ella`,
    ).toBeGreaterThanOrEqual(UMBRAL_GRAFICO);
  });

  it("la medición NO es vacía: `bg-info` —lo que el diseño proponía— SÍ falla en oscuro", () => {
    // Sin esto, el caso de arriba podría pasar por cualquier color y la comprobación sería
    // decorado. Este número es el que motivó la salida escrita en `design.md` §11.6.
    const info = contraste(paleta("info"), token("oscuro", "muted"));
    expect(info).toBeLessThan(UMBRAL_GRAFICO);
  });

  it("el cajón de sastre es tenue A PROPÓSITO, y se deja dicho", () => {
    // `otros` va en `bg-muted-foreground/40` porque no es una categoría más: es lo que no se
    // clasificó, y `DESIGN.md` reserva la saturación para acción y estado. Su contraste con la
    // pista es bajo por diseño (~1.9 claro / ~2.2 oscuro) y no se le aplica el umbral: su dato
    // vive en el `Badge` de debajo, no en el tramo.
    const tenue = contraste(
      componer(token("oscuro", "muted-foreground"), token("oscuro", "muted"), 0.4),
      token("oscuro", "muted"),
    );
    expect(COLOR_SEGMENTO.otros).toContain("muted-foreground");
    expect(tenue).toBeLessThan(UMBRAL_GRAFICO);
  });
});
