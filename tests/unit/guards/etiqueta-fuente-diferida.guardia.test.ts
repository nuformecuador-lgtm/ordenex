import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fuenteEtiqueta,
  PESO_DECLARADO_BASE64,
  PESO_DECLARADO_BYTES,
} from "@/lib/pdf/etiquetas-fuente";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 282 (T5, T25) — GUARDIA del ARTEFACTO DE FUENTE: cuanto pesa, quien lo
 * nombra y por donde entra en cada runtime.
 *
 * Lo que vigila y por que ningun otro test lo veria:
 *
 *  · **R13** — el navegador no puede descargar 22 KB de base64 al abrir el
 *    listado de ordenes. Que hoy no lo haga depende de que el artefacto se
 *    referencie SOLO dentro de un `import()` dinamico; un import estatico
 *    añadido en cualquier archivo de `app/` lo meteria en el bundle inicial sin
 *    romper ni un test ni un tipo. Es un fallo mudo de manual.
 *  · **R14** — el peso declarado tiene que ser el real. Si alguien regenera el
 *    `.ttf` y no vuelve a correr el script, el modulo miente sobre lo que ships.
 *  · **R23** — en el SERVIDOR el mecanismo es el contrario y tambien hay que
 *    vigilarlo: import estatico, nada de `fs`. `next.config.ts` no declara
 *    `outputFileTracingIncludes`, asi que un archivo suelto leido por ruta puede
 *    no llegar a la function y el fallo apareceria SOLO en produccion.
 */

const RAIZ = path.resolve(__dirname, "../../..");
/**
 * El especificador EXACTO del artefacto, con sus comillas. Se busca asi y no por
 * la subcadena `lib/pdf/etiquetas-fuente` porque `etiquetas-fuente-registro`
 * empieza igual: ese modulo SI puede importarse en todas partes (son tipos y
 * funciones, no los 22 KB de base64) y confundirlos daria un rojo que ni existe
 * ni se entiende.
 */
const ARTEFACTO = '"@/lib/pdf/etiquetas-fuente"';
const CARGADOR = "app/(app)/ordenes/_components/etiquetas-fuente-carga.ts";
const GENERADOR_SERVIDOR = "lib/pdf/etiquetas-pdf-lote.ts";
const TTF = path.join(RAIZ, "assets", "fuentes", "LiberationSans-etiqueta-subset.ttf");

/** Tope de R14 para el base64 que viaja al navegador. */
const TOPE_BASE64 = 81920;
/** Objetivo (no puerta): si la cobertura de R11 obliga a pasarlo, manda la cobertura. */
const OBJETIVO_BASE64 = 46080;

/** Todos los `.ts`/`.tsx` de un arbol, en rutas relativas a la raiz con `/`. */
function archivosDe(...tramos: string[]): string[] {
  const raiz = path.join(RAIZ, ...tramos);
  const out: string[] = [];
  const recorrer = (dir: string): void => {
    for (const nombre of readdirSync(dir)) {
      const completo = path.join(dir, nombre);
      if (statSync(completo).isDirectory()) {
        if (nombre === "node_modules" || nombre === ".next") continue;
        recorrer(completo);
        continue;
      }
      if (/\.tsx?$/.test(nombre)) {
        out.push(path.relative(RAIZ, completo).replace(/\\/g, "/"));
      }
    }
  };
  recorrer(raiz);
  return out;
}

describe("R14 — el peso del artefacto, declarado y comprobado", () => {
  it("PESO_DECLARADO_BYTES es el peso REAL del .ttf commiteado", () => {
    const real = readFileSync(TTF).byteLength;
    expect(
      PESO_DECLARADO_BYTES,
      `declarado ${PESO_DECLARADO_BYTES} B, real ${real} B — regenera con \`pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts\``,
    ).toBe(real);
  });

  it("PESO_DECLARADO_BASE64 es lo que realmente viaja en el modulo", () => {
    expect(
      PESO_DECLARADO_BASE64,
      `declarado ${PESO_DECLARADO_BASE64} chars, real ${fuenteEtiqueta.base64.length}`,
    ).toBe(fuenteEtiqueta.base64.length);
  });

  it("no pasa del tope de 80 KB de base64", () => {
    expect(
      fuenteEtiqueta.base64.length,
      `el artefacto ocupa ${fuenteEtiqueta.base64.length} chars de base64`,
    ).toBeLessThanOrEqual(TOPE_BASE64);
  });

  it("y hoy cumple ademas el objetivo de 45 KB (que NO es puerta: manda la cobertura)", () => {
    // Si algun dia la cobertura de R11 obligara a pasar de aqui, esta asercion
    // se actualiza y se REPORTA la cifra; lo que no se hace es recortar glifos
    // para que quepa (decision Q6, firmada).
    expect(fuenteEtiqueta.base64.length).toBeLessThanOrEqual(OBJETIVO_BASE64);
  });

  it("hay UN solo archivo de fuente en el repo: ni un .woff2 ni una segunda copia", () => {
    const fuentes = readdirSync(path.join(RAIZ, "assets", "fuentes"));
    expect(fuentes).toEqual(["LiberationSans-etiqueta-subset.ttf"]);
  });
});

describe("R13 — la fuente no entra en la carga inicial del navegador", () => {
  const enApp = archivosDe("app");
  const enComponentes = archivosDe("components");

  it("SOLO el cargador nombra el artefacto dentro de todo `app/` y `components/`", () => {
    const nombran = [...enApp, ...enComponentes].filter((archivo) =>
      codigoSinComentarios(archivo).includes(ARTEFACTO),
    );
    expect(nombran).toEqual([CARGADOR]);
  });

  it("y lo hace con un `import()` DINAMICO, nunca con un import estatico", () => {
    const codigo = codigoSinComentarios(CARGADOR);
    expect(codigo).toContain(`await import(${ARTEFACTO})`);
    expect(
      codigo,
      "un `import ... from` estatico mete los bytes en el bundle inicial",
    ).not.toMatch(new RegExp(`import[^(]*from ${ARTEFACTO}`));
  });

  it("el generador de cliente NO lo importa: la fuente le llega INYECTADA", () => {
    const codigo = codigoSinComentarios(
      "app/(app)/ordenes/_components/etiquetas-pdf.ts",
    );
    expect(codigo).not.toContain(ARTEFACTO);
    // Lo que si tiene es el parametro obligatorio, que es lo que hace que el
    // compilador cace a quien olvide inyectarla.
    expect(codigo).toContain("fuente: FuenteEmbebida");
  });
});

describe("R23 — en el servidor, import estatico y nada de sistema de archivos", () => {
  it("el generador del lote SI importa el artefacto de forma estatica", () => {
    const codigo = codigoSinComentarios(GENERADOR_SERVIDOR);
    expect(codigo).toMatch(/^import \{ fuenteEtiqueta \} from "\.\/etiquetas-fuente";$/m);
    expect(codigo).not.toMatch(/await import\(/);
  });

  it("ningun modulo de lib/pdf lee la fuente del disco en tiempo de ejecucion", () => {
    for (const archivo of archivosDe("lib", "pdf")) {
      const codigo = codigoSinComentarios(archivo);
      expect(codigo, `${archivo} usa el sistema de archivos`).not.toMatch(
        /readFileSync|node:fs|require\("fs"\)/,
      );
    }
  });

  it("el script que GENERA el artefacto si puede leer del disco (es de build, no de runtime)", () => {
    // Control positivo de la asercion anterior: la prohibicion es de RUNTIME.
    // Si `readFileSync` no apareciera en ningun sitio, el test de arriba estaria
    // verde por vacio.
    const script = codigoSinComentarios("scripts/fuente-etiqueta-a-base64.ts");
    expect(script).toContain("readFileSync");
  });
});
