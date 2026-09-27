import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { ROLES_AYUDA } from "@/lib/ayuda/documento";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import { contextoPara } from "@/lib/asistente/contexto";

/**
 * ⭑ FICHA 436 · R2 — GUARDIA: EL FRONTMATTER NO VIAJA AL PROVEEDOR, Y `fuentes:` MENOS.
 *
 * ⚠️ POR QUÉ IMPORTA. `fuentes:` es la lista de ARCHIVOS DEL CÓDIGO de los que sale cada documento
 * (`app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`, …). El README de la carpeta
 * prohíbe enseñárselo al usuario, y con razón: es el mapa del repositorio. Mandárselo a un
 * proveedor externo en cada consulta —y que el modelo lo repita en una respuesta— es la forma
 * tonta de publicar la estructura interna de la aplicación.
 *
 * Hoy esto se cumple porque el catálogo parte el frontmatter al leer el archivo. Esta guardia mide
 * el RESULTADO y no confía en esa cadena: si mañana alguien cambia la lectura, añade un
 * «rotulado» con los metadatos dentro o le pasa al modelo el archivo crudo, se pone roja.
 *
 * Se mide sobre los 33 documentos REALES y para los cinco roles.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const DIR_AYUDA = path.join(RAIZ, "docs", "ayuda");

const docs = await leerCatalogoAyuda();

/** Los seis campos del contrato de la carpeta, tal y como se escriben en el bloque. */
const CAMPOS = ["titulo", "modulo", "pantalla", "roles", "actualizado", "fuentes"];

describe("436/R2 — ninguna cadena del contexto lleva metadatos", () => {
  it("CONTROL DE NO-VACUIDAD: hay 33 documentos y TODOS traen frontmatter con `fuentes`", () => {
    // Sin esto, un catálogo vacío —o unos documentos sin metadatos— dejarían la guardia verde sin
    // haber comprobado nada. Y es la comprobación que además demuestra que hay algo que esconder.
    expect(docs.length).toBe(33);
    const conFuentes = docs.filter((doc) => {
      const crudo = readFileSync(path.join(DIR_AYUDA, `${doc.slug}.md`), "utf8");
      return (partirFrontmatter(crudo).datos.fuentes ?? []).length > 0;
    });
    expect(conFuentes.length).toBe(33);
  });

  it("⭑ ningún cuerpo enviado contiene la palabra `fuentes:`", () => {
    const culpables: string[] = [];
    for (const rol of ROLES_AYUDA) {
      for (const doc of contextoPara(docs, rol)) {
        if (/^\s*fuentes\s*:/m.test(doc.cuerpo)) culpables.push(`${rol} · ${doc.slug}`);
      }
    }
    expect(culpables).toEqual([]);
  });

  it("⭑⭑ ni UNA SOLA de las rutas de código que `fuentes:` declara", () => {
    // Lo que de verdad no debe salir no es la palabra: son los VALORES. Se leen del archivo real
    // —no de una lista escrita aquí— y se busca cada uno en el cuerpo que se manda.
    const culpables: string[] = [];
    let comprobadas = 0;
    for (const doc of docs) {
      const crudo = readFileSync(path.join(DIR_AYUDA, `${doc.slug}.md`), "utf8");
      for (const fuente of partirFrontmatter(crudo).datos.fuentes ?? []) {
        comprobadas += 1;
        if (doc.cuerpo.includes(fuente)) culpables.push(`${doc.slug} -> ${fuente}`);
      }
    }
    expect(comprobadas, "no se comprobó ninguna fuente: el caso sería vacuo").toBeGreaterThan(100);
    expect(culpables).toEqual([]);
  });

  it("⭑ ningún cuerpo ARRANCA con la apertura `---` del bloque", () => {
    for (const rol of ROLES_AYUDA) {
      for (const doc of contextoPara(docs, rol)) {
        expect(doc.cuerpo.trimStart().startsWith("---"), `${rol} · ${doc.slug}`).toBe(false);
      }
    }
  });

  it("⭑ y el bloque ENTERO de cada archivo no aparece en lo que se manda", () => {
    // La comprobación de bulto, derivada del archivo: se recorta el texto entre las dos líneas
    // `---` y se exige que no esté. Caza cualquier vía que reintroduzca los metadatos, incluida
    // la de mandar el archivo crudo «por comodidad».
    const culpables: string[] = [];
    for (const doc of docs) {
      const crudo = readFileSync(path.join(DIR_AYUDA, `${doc.slug}.md`), "utf8");
      const bloque = /^---\r?\n([\s\S]*?)\r?\n---/.exec(crudo);
      expect(bloque, `${doc.slug} no tiene frontmatter`).not.toBeNull();
      if (doc.cuerpo.includes(bloque![1])) culpables.push(doc.slug);
    }
    expect(culpables).toEqual([]);
  });

  it("ningún campo del contrato de la carpeta aparece como línea de metadatos en el cuerpo", () => {
    const culpables: string[] = [];
    for (const doc of contextoPara(docs, "maestro")) {
      for (const campo of CAMPOS) {
        if (new RegExp(`^${campo}\\s*:`, "m").test(doc.cuerpo)) {
          culpables.push(`${doc.slug} -> ${campo}:`);
        }
      }
    }
    expect(culpables).toEqual([]);
  });

  it("⭑ CONTROL: el archivo CRUDO sí tiene todo eso (si no, lo de arriba sería vacuo)", () => {
    // El otro extremo. Si los `.md` no tuvieran frontmatter, los cinco casos anteriores pasarían
    // sin que nadie estuviera protegiendo nada.
    const crudo = readFileSync(path.join(DIR_AYUDA, "oficina/wallet-caja.md"), "utf8");
    expect(crudo.startsWith("---")).toBe(true);
    expect(crudo).toMatch(/^fuentes:/m);
    expect(crudo).toContain("app/(app)/wallet/_components/WalletModule.tsx");

    const enviado = contextoPara(docs, "maestro").find((d) => d.slug === "oficina/wallet-caja");
    expect(enviado).toBeDefined();
    expect(enviado!.cuerpo).not.toContain("app/(app)/wallet/_components/WalletModule.tsx");
    // Y sin embargo el contenido útil SÍ viaja: no se está midiendo un cuerpo vacío.
    expect(enviado!.cuerpo.length).toBeGreaterThan(500);
  });
});
