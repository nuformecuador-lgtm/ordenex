import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// Feature 284 (R1, R2) — GUARDIA DEL IDIOMA DEL DOCUMENTO.
//
// Hasta hoy el layout raiz declaraba `lang="en"` en una app integramente en español, y los
// otros dos documentos completos del arbol declaraban `es`: o sea que el defecto era
// EXACTAMENTE que uno divergia en solitario, sin que nada lo notara. Un `lang` equivocado no
// rompe ninguna pantalla: cambia como pronuncia el lector de pantalla, que subraya el
// corrector y a que idioma se ofrece a traducir el navegador.
//
// La guardia no comprueba "el layout": hace un CENSO. Afirma cuantos documentos HTML completos
// hay en el arbol de produccion y exige `es` en todos. Afirmar el numero es deliberado: si
// mañana aparece un cuarto documento -o si el escaner deja de encontrarlos-, esto se pone rojo
// en vez de quedarse mudo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const DIRECTORIOS = ["app", "components", "lib", "public"];
const EXTENSIONES = [".ts", ".tsx", ".html"];

/** Todos los archivos de produccion candidatos a contener un documento HTML completo. */
function archivos(dir: string): string[] {
  const absoluto = path.join(RAIZ, dir);
  if (!fs.existsSync(absoluto)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(absoluto, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
    const relativo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivos(relativo));
    else if (EXTENSIONES.includes(path.extname(entrada.name))) salida.push(relativo);
  }
  return salida;
}

/** Texto del archivo SIN comentarios: `app/page.tsx` menciona `<html>` dentro de uno. */
function textoDe(relativo: string): string {
  const crudo = fs.readFileSync(path.join(RAIZ, relativo), "utf8");
  if (relativo.endsWith(".html")) return crudo.replace(/<!--[\s\S]*?-->/g, "");
  return quitarComentarios(crudo);
}

interface Documento {
  archivo: string;
  lang: string | null;
}

function censar(): Documento[] {
  const documentos: Documento[] = [];
  for (const dir of DIRECTORIOS) {
    for (const relativo of archivos(dir)) {
      const texto = textoDe(relativo);
      // La etiqueta de apertura puede repartirse en varias lineas (el layout raiz lo hace).
      for (const apertura of texto.matchAll(/<html\b[^>]*>/g)) {
        const lang = /lang=["{]?["']?([a-zA-Z-]+)["']?/.exec(apertura[0])?.[1] ?? null;
        documentos.push({ archivo: relativo.replace(/\\/g, "/"), lang });
      }
    }
  }
  return documentos;
}

const DOCUMENTOS = censar();

describe("idioma · los documentos HTML de produccion", () => {
  it("el layout raiz declara español", () => {
    const raiz = DOCUMENTOS.find((d) => d.archivo === "app/layout.tsx");
    expect(raiz, "no se encontro el documento raiz: el escaner esta roto").toBeDefined();
    expect(raiz?.lang).toBe("es");
  });

  it("los tres documentos completos y su censo", () => {
    expect(DOCUMENTOS.map((d) => d.archivo).sort()).toEqual([
      "app/api-docs/route.ts",
      "app/layout.tsx",
      "public/offline.html",
    ]);
    for (const documento of DOCUMENTOS) {
      expect(documento.lang, `${documento.archivo} no declara español`).toBe("es");
    }
  });

  it("el escaner distingue un `es` de un `en` (anti-vacuidad)", () => {
    // Sin esto, el censo podria estar verde porque la extraccion del `lang` devuelve siempre
    // lo mismo. Se le pasa el fuente REAL del layout con el defecto reintroducido.
    const layout = textoDe("app/layout.tsx");
    const roto = layout.replace('lang="es"', 'lang="en"');
    expect(roto).not.toBe(layout);
    const apertura = /<html\b[^>]*>/.exec(roto)?.[0] ?? "";
    expect(/lang=["{]?["']?([a-zA-Z-]+)["']?/.exec(apertura)?.[1]).toBe("en");
  });
});
