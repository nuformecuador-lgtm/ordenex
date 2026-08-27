// @vitest-environment jsdom
//
// Feature 292 — GUARDIA DE CONCORDANCIA: la tarjeta de cada contador lleva el color de SU
// segmento en la barra de composición.
//
// ── EL DEFECTO QUE CIERRA, medido el 2026-08-27
// El vocabulario visual de los ocho contadores está declarado DOS veces en `contadores.ts`
// —`COLOR_SEGMENTO` para la barra y `VARIANTE_CONTADOR` para las tarjetas— y las dos tablas se
// habían desincronizado en CUATRO de los ocho: `devueltas` violeta en la barra y ámbar en la
// tarjeta, `incidentes` teja y rojo, `sinRecoger` pizarra y gris, `enReparto` azul marino y azul
// claro. Nada de eso rompía un test: las dos tablas eran exhaustivas, tipadas y verdes. La barra
// simplemente no se podía leer desde las tarjetas, que es lo único que lleva la cifra.
//
// ── POR QUÉ ESTE ARCHIVO, Y NO UNA TERCERA TABLA
// La salida obvia sería derivar las dos tablas de una sola. Se descarta a propósito: una tabla
// derivada haría esta comprobación TAUTOLÓGICA (comparar algo contra su propia fuente siempre
// está verde), y las dos tablas son contratos distintos de verdad —una son clases de Tailwind y
// la otra variantes de una primitiva—. Lo que se comprueba aquí es el PUENTE entre las dos, que
// es exactamente donde se rompió.
//
// ── QUÉ MIDE, y por qué así
// No lee las tablas: RENDERIZA la pantalla y lee las clases que de verdad salen del DOM, las del
// segmento y las del `Badge`, de un mismo render. Así la guardia sigue viva si alguien deja de
// consumir una de las tablas en el componente —que es otra forma de la misma regresión— y no
// hay ni un color escrito a mano en este archivo.

import fs from "fs";
import path from "path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContadoresTablero } from "@/app/(app)/monitoreo/_components/ContadoresTablero";
import {
  CLAVES_CONTADOR,
  COLOR_SEGMENTO,
  VARIANTE_CONTADOR,
} from "@/app/(app)/monitoreo/_components/contadores";
import type { TotalesTableroDia } from "@/lib/types/tablero-dia";

import { REPO_ROOT } from "./_arbol-de-la-feature";

afterEach(cleanup);

/**
 * Los OCHO a uno o más: un contador a cero NO pinta segmento (R69), así que con un cero esta
 * guardia dejaría de mirar ese par sin decirlo. `asignadas` es la suma (identidad de R3).
 */
const CONTADORES: TotalesTableroDia = {
  asignadas: 16,
  entregadas: 5,
  reprogramadas: 2,
  devueltas: 2,
  rechazadas: 1,
  incidentes: 1,
  sinRecoger: 2,
  enReparto: 2,
  otros: 1,
};

/**
 * La familia de color de `otros`: la barra lo pinta con `bg-muted-foreground/40` y la tarjeta va
 * `outline`, sin fondo. Es el ÚNICO alias de este puente y es una decisión de diseño escrita
 * (`DESIGN.md` reserva la saturación para acción y estado; `otros` es el cajón de sastre). Todo
 * lo demás tiene que coincidir por el NOMBRE DEL TOKEN, sin traducciones intermedias.
 */
const SIN_ACENTO = "«sin acento»";

/** Las utilidades con modificador (`dark:`, `focus-visible:`, `[a]:hover:`) no pintan el reposo. */
const enReposo = (clases: string): string[] =>
  clases.split(/\s+/).filter((c) => c.length > 0 && !c.includes(":"));

/**
 * La FAMILIA de color que pinta el fondo de un elemento en reposo:
 *   `bg-chart-6`  ->  `chart-6`      (el segmento: el token a pelo)
 *   `bg-chart-6-soft` -> `chart-6`   (el `Badge`: el `-soft` del par)
 *   `bg-muted-foreground/40` -> «sin acento»
 *   sin ningún `bg-` -> «sin acento»
 *
 * Lanza si hay DOS fondos: con dos, cuál gana depende del orden de las utilidades y devolver
 * uno sería inventarse la respuesta.
 */
function familiaDelFondo(clases: string): string {
  const fondos = enReposo(clases).filter((c) => /^bg-/.test(c));
  if (fondos.length === 0) return SIN_ACENTO;
  if (fondos.length > 1) {
    throw new Error(
      `dos utilidades de fondo en reposo (${fondos.join(", ")}): cuál gana depende del orden, y ` +
        "esta guardia no resuelve la cascada",
    );
  }
  const token = fondos[0]!.replace(/^bg-/, "").replace(/\/\d+$/, "");
  if (token === "muted-foreground") return SIN_ACENTO;
  return token.replace(/-soft$/, "");
}

/** La familia de la TINTA, con la misma regla: `text-chart-6-strong` -> `chart-6`. */
function familiaDeLaTinta(clases: string): string | null {
  const tintas = enReposo(clases).filter((c) => /^text-/.test(c) && !/^text-(xs|sm|base|lg|xl)$/.test(c));
  const fuerte = tintas.find((c) => /-strong$/.test(c));
  return fuerte ? fuerte.replace(/^text-/, "").replace(/-strong$/, "") : null;
}

const CSS = fs.readFileSync(path.join(REPO_ROOT, "app", "globals.css"), "utf8");

function pintar(): { badge: (c: string) => HTMLElement; segmento: (c: string) => HTMLElement } {
  const { container } = render(
    <ContadoresTablero contadores={CONTADORES} etiquetaComposicion="Composición del día" />,
  );
  const buscar = (selector: string, clave: string): HTMLElement => {
    const nodo = container.querySelector(`[${selector}="${clave}"]`);
    if (!(nodo instanceof HTMLElement)) throw new Error(`no se pintó ${selector}="${clave}"`);
    return nodo;
  };
  return {
    badge: (clave) => buscar("data-contador", clave),
    segmento: (clave) => buscar("data-segmento", clave),
  };
}

/* ── El instrumento, antes de creerle nada ──────────────────────────────────────────────── */

describe("Feature 292 · el lector de familias NO es complaciente", () => {
  it("lee el token de un fondo, con y sin `-soft`, y descarta lo que lleva modificador", () => {
    expect(familiaDelFondo("bg-chart-6")).toBe("chart-6");
    expect(familiaDelFondo("bg-chart-6-soft dark:bg-chart-6/15")).toBe("chart-6");
    expect(familiaDelFondo("bg-success-soft text-success-strong dark:bg-success/15")).toBe("success");
    expect(familiaDelFondo("border-border text-foreground [a]:hover:bg-muted")).toBe(SIN_ACENTO);
    expect(familiaDelFondo("bg-muted-foreground/40")).toBe(SIN_ACENTO);
    expect(familiaDeLaTinta("bg-chart-11-soft text-chart-11-strong")).toBe("chart-11");
    expect(familiaDeLaTinta("bg-secondary text-secondary-foreground")).toBeNull();
  });

  it("SEPARA las familias que esta ficha desempareja: si las juntara, sería un verde vacío", () => {
    // Los cuatro valores VIEJOS de `VARIANTE_CONTADOR` contra el token de su segmento. Si el
    // lector devolviera lo mismo para los dos lados de cualquiera de estas parejas, la guardia
    // de abajo pasaría con el defecto puesto.
    for (const [variante, segmento] of [
      ["bg-warning-soft", "bg-chart-6"],
      ["bg-danger-soft", "bg-chart-11"],
      ["bg-secondary", "bg-chart-12"],
      ["bg-info-soft", "bg-chart-13"],
    ] as const) {
      expect(familiaDelFondo(variante)).not.toBe(familiaDelFondo(segmento));
    }
  });

  it("dos fondos en reposo son un error, no una respuesta a medias", () => {
    expect(() => familiaDelFondo("bg-success-soft bg-chart-6-soft")).toThrow(/dos utilidades/);
  });
});

/* ── EL CENSO: los ocho pares, del DOM ──────────────────────────────────────────────────── */

describe("Feature 292 · cada tarjeta lleva el color de SU segmento", () => {
  it("el censo mira los OCHO: ninguno se queda sin segmento por valer cero", () => {
    const { badge, segmento } = pintar();
    for (const clave of CLAVES_CONTADOR) {
      expect(CONTADORES[clave], `${clave} vale 0 y no pintaría segmento`).toBeGreaterThan(0);
      expect(badge(clave).getAttribute("data-variant")).toBe(VARIANTE_CONTADOR[clave]);
      expect(segmento(clave).className).toContain(COLOR_SEGMENTO[clave]);
    }
    expect(CLAVES_CONTADOR).toHaveLength(8);
  });

  it.each([...CLAVES_CONTADOR])(
    "«%s»: el fondo de la tarjeta y el del segmento son la MISMA familia de color",
    (clave) => {
      const { badge, segmento } = pintar();
      const deLaBarra = familiaDelFondo(segmento(clave).className);
      const deLaTarjeta = familiaDelFondo(badge(clave).className);

      expect(
        deLaTarjeta,
        `«${clave}» se pinta ${deLaBarra} en la barra y ${deLaTarjeta} en su tarjeta. Quien mira ` +
          "la barra no puede leerla desde las tarjetas, que son las que llevan la cifra.",
      ).toBe(deLaBarra);
    },
  );

  it("la tinta de cada tarjeta es el `-strong` de esa misma familia, no de otra", () => {
    const { badge } = pintar();
    for (const clave of CLAVES_CONTADOR) {
      const clases = badge(clave).className;
      const tinta = familiaDeLaTinta(clases);
      if (tinta === null) continue; // `outline`/`secondary` no usan par: se cubren arriba.
      expect(tinta, `la tarjeta de «${clave}» mezcla el fondo de una familia con la tinta de otra`)
        .toBe(familiaDelFondo(clases));
    }
  });

  it("la barra sigue distinguiendo OCHO categorías, y las tarjetas también", () => {
    // El otro modo de pasar la comprobación de arriba es pintarlo todo del mismo color. La barra
    // existe para separar ocho cosas: si dos contadores acabaran compartiendo familia, la
    // concordancia sería cierta y la pantalla habría perdido información.
    const { badge, segmento } = pintar();
    const familias = (lee: (c: string) => HTMLElement) =>
      new Set(CLAVES_CONTADOR.map((clave) => familiaDelFondo(lee(clave).className)));

    expect(familias(segmento).size).toBe(CLAVES_CONTADOR.length);
    expect(familias(badge).size).toBe(CLAVES_CONTADOR.length);
  });

  it("cada utilidad de color de las tarjetas apunta a un token declarado en `globals.css`", () => {
    // Una clase sin token detrás compila, no rompe nada y NO PINTA: el fondo se queda
    // transparente y la tinta hereda, así que la tarjeta vuelve a no llevar el color de su
    // segmento — en verde. Es la familia de defectos que no da la cara.
    const { badge } = pintar();
    const TAMANOS = /^(?:xs|sm|base|lg|xl|\d?xl)$/;
    let comprobadas = 0;

    for (const clave of CLAVES_CONTADOR) {
      for (const clase of enReposo(badge(clave).className).filter((c) => /^(?:bg|text)-/.test(c))) {
        const nombre = clase.replace(/^(?:bg|text)-/, "").replace(/\/\d+$/, "");
        if (TAMANOS.test(nombre)) continue; // `text-xs` es tamaño de letra, no color.
        expect(CSS, `--color-${nombre} no existe: \`${clase}\` no pinta nada`).toContain(
          `--color-${nombre}:`,
        );
        comprobadas += 1;
      }
    }
    // Que el bucle no se haya quedado sin nada que mirar.
    expect(comprobadas).toBeGreaterThanOrEqual(CLAVES_CONTADOR.length);
  });
});
