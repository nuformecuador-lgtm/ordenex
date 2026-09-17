import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import { contextoPara, documentoDePartida } from "@/lib/asistente/contexto";

/**
 * ⭑ FICHA 436 · R1 — EL CONTEXTO SE CONSTRUYE CON LOS CUERPOS DEL CATÁLOGO Y CON NADA MÁS.
 *
 * La comparación es contra el ARCHIVO REAL, no contra un literal escrito aquí. La diferencia
 * importa: un test con el texto copiado dentro afirma que dos copias coinciden, y seguiría verde
 * si el asistente empezara a leer de otro sitio con el mismo contenido de ayer. Lo que se mide es
 * que lo que se manda ES lo que hay en `docs/ayuda/**` hoy.
 */

const DIR_AYUDA = path.resolve(__dirname, "../../../docs/ayuda");
const docs = await leerCatalogoAyuda();
const contexto = contextoPara(docs, "maestro");

describe("R1 — la única fuente son los documentos del catálogo", () => {
  it("CONTROL DE NO-VACUIDAD: el catálogo trae los 33 documentos y el contexto del maestro también", () => {
    expect(docs.length).toBe(33);
    expect(contexto.length).toBe(33);
  });

  it("⭑ cada cuerpo enviado es IDÉNTICO al del archivo en disco, sin su frontmatter", () => {
    for (const enviado of contexto) {
      const crudo = readFileSync(path.join(DIR_AYUDA, `${enviado.slug}.md`), "utf8");
      const { cuerpo } = partirFrontmatter(crudo);
      // Igualdad ESTRICTA de la cadena entera: ni recortado, ni resumido, ni reescrito. Si algún
      // día alguien mete un «resumidor» en medio, este caso lo dice por el slug.
      expect(enviado.cuerpo, enviado.slug).toBe(cuerpo);
    }
  });

  it("⭑ y cada título sale del frontmatter de ESE archivo", () => {
    for (const enviado of contexto) {
      const crudo = readFileSync(path.join(DIR_AYUDA, `${enviado.slug}.md`), "utf8");
      expect(enviado.titulo, enviado.slug).toBe(partirFrontmatter(crudo).datos.titulo);
    }
  });

  it("⭑ no se cuela NINGÚN documento que no exista en `docs/ayuda/**`", () => {
    const delCatalogo = new Set(docs.map((d) => d.slug));
    const intrusos = contexto.map((c) => c.slug).filter((slug) => !delCatalogo.has(slug));
    expect(intrusos).toEqual([]);
  });

  it("el README de la carpeta NO es un documento y no viaja (es el contrato de quien escribe)", () => {
    // `docs/ayuda/README.md` son las reglas de la carpeta, no ayuda de usuario. El catálogo lo
    // excluye a propósito y el asistente hereda esa exclusión sin decidir nada por su cuenta.
    expect(contexto.map((c) => c.slug)).not.toContain("README");
    const readme = readFileSync(path.join(DIR_AYUDA, "README.md"), "utf8");
    const juntos = contexto.map((c) => c.cuerpo).join("\n");
    expect(juntos).not.toContain("Cómo se escribe acá");
    expect(readme).toContain("Cómo se escribe acá");
  });

  it("el contexto no añade texto propio: la suma de los cuerpos es la de los archivos", () => {
    // Una comprobación de bulto, y aun así útil: caza un prólogo, un epílogo o una nota metida en
    // cada documento «para ayudar al modelo», que es la forma más fácil de dejar de cumplir R1.
    const enviados = contexto.reduce((n, c) => n + c.cuerpo.length, 0);
    const delDisco = docs.reduce((n, d) => n + d.cuerpo.length, 0);
    expect(enviados).toBe(delDisco);
  });
});

describe("R27 (la mitad de servidor) — el documento de PARTIDA sale del contexto ya acotado", () => {
  it("abierto desde /mis-asignaciones/reparto, el de partida de un mensajero es `mensajero/reparto`", () => {
    const suyo = contextoPara(docs, "mensajero");
    expect(documentoDePartida(docs, suyo, "/mis-asignaciones/reparto")).toBe("mensajero/reparto");
  });

  it("⭑ una `rutaActual` de otro portal NO abre ninguna puerta: se ignora", () => {
    // `rutaActual` la manda el cliente. Un mensajero que dijera «vengo de /wallet» no consigue ni
    // el documento de partida ni —sobre todo— que su contexto crezca: el conjunto ya estaba
    // decidido antes de mirarla.
    const suyo = contextoPara(docs, "mensajero");
    expect(documentoDePartida(docs, suyo, "/wallet")).toBeNull();
    expect(suyo.map((d) => d.slug)).not.toContain("oficina/wallet-caja");
  });

  it("una ruta inventada o ausente devuelve `null` sin romper nada", () => {
    const suyo = contextoPara(docs, "mensajero");
    expect(documentoDePartida(docs, suyo, "/no-existe")).toBeNull();
    expect(documentoDePartida(docs, suyo, undefined)).toBeNull();
  });

  it("CONTROL: para el maestro, /wallet SÍ tiene documento de partida", () => {
    const suyo = contextoPara(docs, "maestro");
    expect(documentoDePartida(docs, suyo, "/wallet")).toBe("oficina/wallet-caja");
  });
});
