// Feature 211 — guardia del MECANISMO que enciende el tema.
//
// El control de la cabecera se prueba en `tests/components/TemaToggle.test.tsx`. Lo que
// aqui se vigila es la parte que ningun test de componente ve, porque no es React: el CSS
// que hace que la clase signifique algo, y el punto del arbol donde esa clase se estampa.
// Las cuatro piezas se rompen en silencio —siguen compilando, siguen pasando 12.000
// tests— y el sintoma solo aparece mirando la aplicacion:
//
//  1. Si el bloque de `.tema-sistema` deja de espejar a `.dark`, el estado POR DEFECTO
//     queda con una paleta a medias.
//  2. Si el variant `dark:` pierde su rama de `prefers-color-scheme`, en «sistema» giran
//     los tokens pero NO las utilidades `dark:` — el bug que la 208 documento como el mas
//     repetido del repo.
//  3. Si desaparece `body:has(...)`, vuelve la franja clara alrededor de la app oscura.
//  4. Si el layout deja de montar el proveedor, el control sigue ahi y no enciende nada.

import path from "node:path";

import { describe, expect, it } from "vitest";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

const GLOBALS = "app/globals.css";
const LAYOUT = path.join("app", "(app)", "layout.tsx");
const HEADER = "components/shared/PageHeader.tsx";

interface Regla {
  selectores: string[];
  ancestros: string[];
  declaraciones: Record<string, string>;
}

/** Corta por comas de PRIMER nivel: las de `:is(a, b)` o `[attr="x,y"]` no separan. */
function selectoresDe(prelude: string): string[] {
  const partes: string[] = [];
  let actual = "";
  let hondura = 0;
  for (const c of prelude) {
    if (c === "(" || c === "[") hondura += 1;
    else if (c === ")" || c === "]") hondura -= 1;
    if (c === "," && hondura === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  partes.push(actual);
  return partes.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

function declaracionesDe(cuerpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trozo of cuerpo.split(";")) {
    if (trozo.includes("{")) continue;
    const i = trozo.indexOf(":");
    if (i < 0) continue;
    const nombre = trozo.slice(0, i).trim();
    if (!nombre || /[{}]/.test(nombre)) continue;
    out[nombre] = trozo.slice(i + 1).trim().replace(/\s+/g, " ");
  }
  return out;
}

/**
 * Todas las reglas del CSS con su prelude, sus ancestros (`@media`, `@layer`…) y sus
 * declaraciones propias. Los comentarios se quitan ANTES con el quitador compartido del
 * repo (feature 209): sin eso, esta misma guardia daria verde con el mecanismo entero
 * borrado, porque `globals.css` explica en prosa todo lo que declara.
 */
function reglasDe(css: string): Regla[] {
  const reglas: Regla[] = [];
  const pila: { prelude: string; desde: number }[] = [];
  let marca = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === "{") {
      pila.push({ prelude: css.slice(marca, i).trim(), desde: i + 1 });
      marca = i + 1;
    } else if (c === "}") {
      const regla = pila.pop();
      marca = i + 1;
      if (!regla) continue;
      reglas.push({
        selectores: selectoresDe(regla.prelude),
        ancestros: pila.map((p) => p.prelude.replace(/\s+/g, " ")),
        declaraciones: declaracionesDe(css.slice(regla.desde, i)),
      });
    } else if (c === ";") {
      marca = i + 1;
    }
  }
  return reglas;
}

const css = codigoSinComentarios(GLOBALS);
const reglas = reglasDe(css);

function reglaCon(selector: string): Regla {
  const hallazgos = reglas.filter((r) => r.selectores.includes(selector));
  expect(hallazgos.length, `no hay ninguna regla para \`${selector}\` en ${GLOBALS}`).toBe(1);
  return hallazgos[0]!;
}

describe("feature 211 — el CSS que enciende el tema", () => {
  it("«sistema» toma EXACTAMENTE los mismos tokens que «oscuro», hasta el ultimo hex", () => {
    const oscuro = reglaCon(".dark");
    const sistema = reglaCon(".tema-sistema");

    // Que no sea un bloque vacio que pase por casualidad.
    expect(Object.keys(oscuro.declaraciones).length).toBeGreaterThan(20);
    expect(Object.keys(sistema.declaraciones)).toEqual(Object.keys(oscuro.declaraciones));
    expect(sistema.declaraciones).toEqual(oscuro.declaraciones);
  });

  it("los tokens de «sistema» viven DENTRO de `prefers-color-scheme: dark` (si no, oscuro siempre)", () => {
    const sistema = reglaCon(".tema-sistema");
    expect(sistema.ancestros.join(" | ")).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);

    const oscuro = reglaCon(".dark");
    expect(
      oscuro.ancestros.join(" | "),
      "`.dark` no puede depender de la preferencia del sistema: es la eleccion EXPLICITA",
    ).not.toMatch(/prefers-color-scheme/);
  });

  it("el `<body>` toma los mismos tokens que el envoltorio: sin eso queda una franja clara", () => {
    const oscuro = reglas.find((r) => r.selectores.includes(".dark"))!;
    const sistema = reglas.find((r) => r.selectores.includes(".tema-sistema"))!;

    expect(oscuro.selectores).toContain("body:has(> .dark)");
    expect(sistema.selectores).toContain("body:has(> .tema-sistema)");
  });

  it("el variant `dark:` dispara por CLASE y tambien por preferencia del sistema", () => {
    const bloque = css.slice(css.indexOf("@custom-variant dark"));
    const cierre = (() => {
      let hondura = 0;
      for (let i = bloque.indexOf("{"); i < bloque.length; i += 1) {
        if (bloque[i] === "{") hondura += 1;
        else if (bloque[i] === "}") {
          hondura -= 1;
          if (hondura === 0) return i;
        }
      }
      return -1;
    })();
    expect(cierre, "no se encontro el bloque de `@custom-variant dark`").toBeGreaterThan(0);
    const cuerpo = bloque.slice(0, cierre + 1);

    expect(cuerpo, "falta la rama por clase (.dark)").toMatch(/&:is\(\.dark \*\)/);
    expect(cuerpo, "falta la rama por preferencia del sistema").toMatch(
      /@media\s*\(prefers-color-scheme:\s*dark\)/,
    );
    expect(cuerpo, "la rama del sistema no se ancla a `.tema-sistema`").toMatch(
      /&:is\(\.tema-sistema \*\)/,
    );
    // Dos `@slot`: uno por rama. Con uno solo, una de las dos no emite nada.
    expect(cuerpo.match(/@slot/g) ?? []).toHaveLength(2);
  });

  it("`.tema-claro` sigue fijando los valores claros (la landing y la factura dependen de ello)", () => {
    const claro = reglaCon(".tema-claro");
    expect(claro.selectores).toContain(":root");
    expect(claro.declaraciones["--background"]).toBe("#f7f8fc");
  });
});

describe("feature 211 — donde se estampa la clase", () => {
  const layout = codigoSinComentarios(LAYOUT);

  it("el layout del portal lee la cookie EN EL SERVIDOR y monta el proveedor", () => {
    expect(layout, "no lee la cookie del tema").toMatch(/cookies\(\)/);
    expect(layout).toMatch(/COOKIE_TEMA/);
    expect(layout, "no normaliza el valor de la cookie").toMatch(/normalizarTema/);
    expect(layout, "no monta el proveedor: el control no encenderia nada").toMatch(
      /<TemaProvider\s+temaInicial=/,
    );
  });

  it("la cookie NO se lee en el layout raiz: eso volveria dinamica la landing publica", () => {
    const raiz = codigoSinComentarios("app/layout.tsx");
    expect(raiz).not.toMatch(/cookies\(\)/);
    expect(raiz).not.toMatch(/ordenex_tema|COOKIE_TEMA|TemaProvider/);
  });

  it("el interruptor vive en el encabezado, que es la unica pieza de toda pagina autenticada", () => {
    const header = codigoSinComentarios(HEADER);
    expect(header).toMatch(/<TemaToggle\s*\/>/);
  });
});
