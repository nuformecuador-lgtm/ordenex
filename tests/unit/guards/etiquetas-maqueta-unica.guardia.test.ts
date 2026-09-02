import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 282 (T19, R21) — GUARDIA: UNA SOLA FUENTE DE VERDAD DE LA MAQUETA.
 *
 * Es la segunda de las tres capas que impiden que los dos generadores de
 * etiquetas vuelvan a divergir. La primera es el test que compara los dos PDF
 * (`tests/unit/pdf/etiquetas-dos-generadores.test.ts`); la tercera es el
 * compilador, que al no existir ya las constantes locales obliga a *añadir*
 * codigo para escribir un numero a mano en vez de a *olvidar* actualizarlo.
 *
 * Esta capa cubre lo que las otras dos no ven: alguien que reintroduzca una
 * constante propia con el MISMO valor que la compartida. Los dos PDF seguirian
 * coincidiendo y el compilador no diria nada — hasta el dia en que alguien
 * cambie la compartida y solo se mueva uno de los dos.
 *
 * Que esto es real y no una precaucion teorica lo dice el propio repo: la
 * cabecera del generador del servidor declaraba ser «espejo EXACTO» del de
 * cliente, y llevaba desde la feature 150 sin serlo.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const GENERADOR_CLIENTE = "app/(app)/ordenes/_components/etiquetas-pdf.ts";
const GENERADOR_SERVIDOR = "lib/pdf/etiquetas-pdf-lote.ts";
const MAQUETA = "lib/pdf/etiquetas-maqueta.ts";

/**
 * Los nombres que NINGUNO de los dos generadores puede volver a declarar por su
 * cuenta. Cada uno estuvo duplicado de verdad: son los que `etiquetas-pdf.ts` y
 * `etiquetas-pdf-lote.ts` tenian escritos a mano antes de esta ficha.
 */
const CONSTANTES_PROHIBIDAS = [
  // Feature 282: las que los dos generadores tenian escritas a mano.
  "CAMPOS_Y_INICIO",
  "FONT_ROTULO",
  "FONT_VALOR",
  "FONT_GUIA",
  "FONT_REMISION",
  "LINE_HEIGHT",
  "FIELD_GAP",
  "MARGIN",
  "SIZE_MM",
  "CONTENT_WIDTH",
  "QR_SIZE",
  "GAP_TEXTO_CODIGOS",
  "GAP_ROTULO_VALOR",
  // Feature 350: las que estrena el rediseño. Van aqui el MISMO dia que nacen,
  // no cuando alguien las duplique: la prohibicion solo sirve si llega antes.
  "CUERPO_MINIMO_PT",
  "CUERPO_MINIMO_DESTACADO_PT",
  "CUERPOS_BASE",
  "PASO_AJUSTE_PT",
  "INTERLINEADO",
  "BANDAS",
  "GAPS_ENTRE_BANDAS",
  "GAP_BANDAS_TOTAL_MM",
  "GAP_CAMPOS_MM",
  "MARGEN_MM",
  "ANCHO_UTIL_BASE_MM",
  "CELDA_BASE_MM",
  "QR_MM",
  "BARCODE_MM",
  // Feature 353 — los grosores de trazo del diseño. Son geometria compartida:
  // el «borde grueso» del recuadro y la regla de la cabecera se ven en el papel
  // de los DOS generadores, y un espejo a mano volveria a divergir.
  "GROSOR_RECUADRO_MM",
  "GROSOR_REGLA_MM",
];

describe("R21 — ningun generador declara por su cuenta la geometria de la etiqueta", () => {
  for (const archivo of [GENERADOR_CLIENTE, GENERADOR_SERVIDOR]) {
    it(`${archivo} no declara ninguna constante de maqueta propia`, () => {
      const codigo = codigoSinComentarios(archivo);
      const reincidentes = CONSTANTES_PROHIBIDAS.filter((nombre) =>
        new RegExp(`\\b(const|let|var|function)\\s+${nombre}\\b`).test(codigo),
      );
      expect(
        reincidentes,
        `declara por su cuenta ${reincidentes.join(", ")}: eso vive en ${MAQUETA}`,
      ).toEqual([]);
    });
  }

  it("la maqueta compartida SI las declara (si no, la prohibicion de arriba seria vacia)", () => {
    const maqueta = codigoSinComentarios(MAQUETA);
    // El control positivo de esta guardia: los valores existen en algun sitio.
    for (const trozo of [
      // Las de la 282 que siguen vivas.
      "margen:",
      "fontRotulo:",
      "fontGuia:",
      "fontRemision:",
      "qrSize:",
      "GAP_TEXTO_CODIGOS",
      "GAP_ROTULO_VALOR",
      "LIENZO_BASE_MM",
      // Feature 350: el control positivo se amplia EN PARALELO a la lista
      // prohibida. Si no, prohibir un nombre que no existe en ningun sitio
      // seria una prohibicion vacia — verde y sin contenido.
      "CUERPO_MINIMO_PT",
      "CUERPO_MINIMO_DESTACADO_PT",
      "CUERPOS_BASE",
      "PASO_AJUSTE_PT",
      "INTERLINEADO",
      "BANDAS",
      "GAPS_ENTRE_BANDAS",
      "GAP_CAMPOS_MM",
      "MARGEN_MM",
      "ANCHO_UTIL_BASE_MM",
      "CELDA_BASE_MM",
      "QR_MM",
      "BARCODE_MM",
      "separacionBajoGuiaMm",
      // Feature 353, en paralelo a la lista prohibida.
      "GROSOR_RECUADRO_MM",
      "GROSOR_REGLA_MM",
    ]) {
      expect(maqueta, `${MAQUETA} ya no declara ${trozo}`).toContain(trozo);
    }
  });

  it("los dos generadores TOMAN la geometria del modulo compartido", () => {
    for (const archivo of [GENERADOR_CLIENTE, GENERADOR_SERVIDOR]) {
      const codigo = codigoSinComentarios(archivo);
      expect(codigo, `${archivo} ya no usa el dibujo compartido`).toMatch(
        /from "(@\/lib\/pdf|\.)\/etiquetas-dibujo"/,
      );
      expect(codigo, `${archivo} ya no usa el layout compartido`).toMatch(
        /from "(@\/lib\/pdf|\.)\/etiquetas-layout"/,
      );
    }
  });

  it("no queda un `drawCampos` propio en ninguno de los dos", () => {
    for (const archivo of [GENERADOR_CLIENTE, GENERADOR_SERVIDOR]) {
      const codigo = codigoSinComentarios(archivo);
      expect(codigo, `${archivo} conserva su propio drawCampos`).not.toMatch(
        /function\s+drawCampos/,
      );
      expect(codigo, `${archivo} conserva su propio drawEtiqueta`).not.toMatch(
        /function\s+drawEtiqueta/,
      );
    }
  });

  it("tampoco reimplementan el AJUSTE (feature 350)", () => {
    // El motor que decide cuerpos y saltos de linea es lo mas facil de volver a
    // escribir «solo para este caso», y seria la divergencia mas cara: uno de
    // los dos PDF recortaria y el otro no.
    for (const archivo of [GENERADOR_CLIENTE, GENERADOR_SERVIDOR]) {
      const codigo = codigoSinComentarios(archivo);
      for (const nombre of ["partirEnLineas", "ajustarBloque", "splitTextToSize"]) {
        expect(codigo, `${archivo} maqueta texto por su cuenta (${nombre})`).not.toContain(
          nombre,
        );
      }
    }
  });

  it("el modulo de maqueta viejo bajo app/ NO existe, y tampoco un puente que lo re-exporte", () => {
    // Sin archivo-puente: un puente re-exportador seria otro sitio donde volver
    // a divergir, que es justo lo que esta ficha viene a cerrar.
    expect(
      existsSync(path.join(RAIZ, "app/(app)/ordenes/_components/etiquetas-layout.ts")),
    ).toBe(false);
  });

  it("el catalogo de tamaños sigue siendo del cliente: el servidor usa el lienzo base", () => {
    // D3 de la feature 150: el PDF que reciben los integradores por API es
    // 100 x 100 fijo. Al compartir la maqueta habia que elegir entre pasarle el
    // catalogo o darle un layout base; se eligio lo segundo por esto.
    const servidor = codigoSinComentarios(GENERADOR_SERVIDOR);
    expect(servidor).toContain("crearLayoutBase()");
    expect(servidor).not.toMatch(/crearLayout\(/);
    expect(servidor).not.toContain("etiquetas-hoja");
    expect(servidor).not.toContain("HOJAS_ETIQUETA");
  });
});

describe("R21 — la maqueta vive en lib/pdf, donde los dos runtimes la alcanzan", () => {
  it("todos los modulos compartidos estan bajo lib/pdf (el servidor no puede importar de app/)", () => {
    for (const modulo of [
      "etiquetas-maqueta.ts",
      "etiquetas-layout.ts",
      "etiquetas-dibujo.ts",
      "etiquetas-fuente.ts",
      "etiquetas-fuente-registro.ts",
      "etiquetas-ajuste.ts",
    ]) {
      expect(
        existsSync(path.join(RAIZ, "lib", "pdf", modulo)),
        `falta lib/pdf/${modulo}`,
      ).toBe(true);
    }
  });

  it("ningun modulo de lib/pdf importa de app/ (el lote corre en Node)", () => {
    const dir = path.join(RAIZ, "lib", "pdf");
    for (const nombre of readdirSync(dir)) {
      if (!nombre.endsWith(".ts") || !statSync(path.join(dir, nombre)).isFile()) continue;
      const codigo = codigoSinComentarios(path.join("lib", "pdf", nombre).replace(/\\/g, "/"));
      expect(codigo, `lib/pdf/${nombre} importa de app/`).not.toMatch(
        /from "@\/app\//,
      );
    }
  });
});
