import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import { ARCHIVO_EXCLUIDO } from "@/lib/ayuda/catalogo";

// ⭑ FICHA 433 — LAS DOS COSAS QUE EL MÓDULO NO PUEDE HACER AL PINTAR UN DOCUMENTO.
//
// 1. NO ENSEÑAR `fuentes`. Es el campo que hace auditable cada afirmación del documento
//    —«de dónde sale lo que esto dice»— y el README de la carpeta dice literalmente que «no se
//    muestra al usuario». A quien está atascado en la calle una lista de archivos `.tsx` no le
//    sirve de nada, y además delata la estructura interna del repositorio a las cuentas de
//    tienda y de bodega, que son de gente ajena a la empresa.
//
// 2. NO MENTIR AL RENDERIZAR. El renderizador (`lib/ayuda/markdown.tsx`) cubre el subconjunto
//    de Markdown que los documentos usan HOY, medido: 0 enlaces, 0 imágenes, 0 HTML crudo. Si
//    mañana alguien escribe un enlace o una imagen, la sintaxis se pinta como texto literal —
//    `![foto](ruta.png)` a la vista, en medio de la explicación— y nadie se entera, porque no
//    rompe nada. Esta guardia obliga a que esa decisión la tome una persona: o se amplía el
//    renderizador, o se reescribe el párrafo.
//
// SE DECLARA COMO GUARDIA PORQUE NO IMPORTA LO QUE VIGILA: lee archivos del disco, así que
// ningún grafo de imports la seleccionaría en el modo rápido. Las guardias corren SIEMPRE.

const RAIZ = process.cwd();
const DIR_AYUDA = path.join(RAIZ, "docs", "ayuda");

function listarMarkdown(prefijo = ""): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(path.join(DIR_AYUDA, prefijo), { withFileTypes: true })) {
    const relativo = prefijo === "" ? entrada.name : `${prefijo}/${entrada.name}`;
    if (entrada.isDirectory()) encontrados.push(...listarMarkdown(relativo));
    else if (entrada.name.endsWith(".md")) encontrados.push(relativo);
  }
  return encontrados;
}

const DOCUMENTOS = listarMarkdown()
  .filter((relativo) => relativo !== ARCHIVO_EXCLUIDO)
  .map((relativo) => ({
    relativo,
    ...partirFrontmatter(readFileSync(path.join(DIR_AYUDA, relativo), "utf8")),
  }));

/** El fuente de las piezas que pintan un documento. Si una nombra `fuentes`, lo está enseñando. */
const PINTAN_EL_DOCUMENTO = [
  "app/(app)/ayuda/[...slug]/page.tsx",
  "app/(app)/ayuda/_components/AyudaIndice.tsx",
  "lib/ayuda/markdown.tsx",
];

describe("ayuda · `fuentes` es para auditar, no para leer", () => {
  it("hay documentos que vigilar", () => {
    expect(DOCUMENTOS.length).toBeGreaterThanOrEqual(30);
  });

  it("los documentos SÍ declaran `fuentes` (si no, el resto de la guardia sería vacuo)", () => {
    const sinFuentes = DOCUMENTOS.filter((d) => (d.datos.fuentes ?? []).length === 0);
    expect(sinFuentes.map((d) => d.relativo)).toEqual([]);
  });

  it("ninguna pieza que pinta un documento lee el campo `fuentes`", () => {
    const culpables = PINTAN_EL_DOCUMENTO.filter((relativo) =>
      /\bfuentes\b/.test(despuesDeLosComentarios(readFileSync(path.join(RAIZ, relativo), "utf8"))),
    );
    expect(culpables).toEqual([]);
  });

  it("y el cuerpo que se renderiza NO arrastra el bloque de metadatos", () => {
    const contaminados = DOCUMENTOS.filter(
      (d) => d.cuerpo.includes("fuentes:") || d.cuerpo.startsWith("---"),
    ).map((d) => d.relativo);
    expect(contaminados).toEqual([]);
  });
});

describe("ayuda · ningún documento usa sintaxis que el renderizador no sepa pintar", () => {
  const sinCodigo = (cuerpo: string) =>
    // Dentro de un bloque de código no se interpreta nada, así que lo que haya ahí no cuenta.
    cuerpo.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

  it("sin imágenes", () => {
    const con = DOCUMENTOS.filter((d) => /!\[[^\]]*\]\(/.test(sinCodigo(d.cuerpo)));
    expect(con.map((d) => d.relativo)).toEqual([]);
  });

  it("sin enlaces en forma de Markdown", () => {
    const con = DOCUMENTOS.filter((d) => /\[[^\]]+\]\([^)]+\)/.test(sinCodigo(d.cuerpo)));
    expect(con.map((d) => d.relativo)).toEqual([]);
  });

  it("sin HTML crudo", () => {
    const con = DOCUMENTOS.filter((d) => /<\/?[a-zA-Z][^>]*>/.test(sinCodigo(d.cuerpo)));
    expect(con.map((d) => d.relativo)).toEqual([]);
  });

  it("sin listas anidadas (el renderizador no las distingue de una continuación de línea)", () => {
    const con = DOCUMENTOS.filter((d) =>
      d.cuerpo.split(/\r?\n/).some((linea) => /^ {2,}[-*+]\s+/.test(linea)),
    );
    expect(con.map((d) => d.relativo)).toEqual([]);
  });
});

/**
 * Quita comentarios de línea y de bloque. Existe porque los comentarios de estas piezas
 * EXPLICAN por qué `fuentes` no se pinta, y sin esto la guardia se acusaría a sí misma.
 */
function despuesDeLosComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
