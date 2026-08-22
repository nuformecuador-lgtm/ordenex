import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { REPO_ROOT } from "./_arbol-de-la-feature";

// Feature 260 (C1) — R42. **LA GUARDIA DE QUE EL CÓDIGO Y EL SPEC NO MIENTAN.**
//
// R49 de la feature 192 («el detalle son estas CUATRO columnas y ninguna más», cerrada por
// decisión humana el 2026-08-08) se REVIRTIÓ el 2026-08-21. Una decisión revertida vive en DOS
// soportes y los dos pueden envejecer por separado:
//
//   (1) `app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx` — ahí vivía la constante
//       `COLUMNAS` con el docstring que enunciaba R49 con autoridad. Su texto se SUSTITUYÓ por
//       la nota de reversión; si mañana alguien vuelve a declarar columnas en el panel, esa
//       nota pasa a mentir sin que nada más se ponga rojo.
//   (2) `specs/192-tablero-dia-mensajeros/requirements.md` §R49 — donde se firmó. Sin marca,
//       quien lo lea dentro de seis meses creerá que el detalle sigue cerrado en cuatro.
//
// ⚠️ POR QUÉ LA MITAD (2) COMPRUEBA LAS DOS DIRECCIONES. Es la lección que la 259 dejó escrita
// en `d10-revertida.guardia.test.ts`, y se copia deliberadamente: un spec es la foto de su
// momento, así que el apéndice APUNTA a la ficha nueva pero el texto original **no se toca**.
// Si esta guardia sólo exigiera el puntero, un «ya que estamos» podría reescribir R49 para
// «dejarlo coherente» y borraría la única prueba de que aquel alcance se cerró a conciencia.
// Anotar acabaría siendo reescribir por la puerta de atrás.
//
// ⚠️ Y POR QUÉ EL DETECTOR DEL PANEL MIRA EL CÓDIGO Y NO LA PROSA. La nota de reversión CITA la
// frase que sustituye («las columnas del detalle, y NINGUNA mas») — tiene que citarla, o no se
// entendería qué se revirtió. Un detector de frases prohibidas sobre el texto crudo marcaría
// esa cita como infracción y obligaría a borrar la explicación para pasar la guardia, que es
// justo al revés. Lo que se mide es lo que el panel HACE: que no vuelva a declarar columnas.
//
// Cada detector es una función PURA y al final hay una AUTOCOMPROBACIÓN: se le da un texto que
// SÍ infringe y otro que no. Sin eso, una guardia de prosa puede quedarse verde por vacía — un
// patrón que dejó de encajar tras un rename se lee igual de verde que un árbol limpio.

const PANEL = "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx";
const MODULO_DE_COLUMNAS = "app/(app)/monitoreo/_components/detalle-columnas.ts";
const SPEC_192 = "specs/192-tablero-dia-mensajeros/requirements.md";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/* -------------------------------------------------------------------------- */
/* (1) El panel                                                                */
/* -------------------------------------------------------------------------- */

/**
 * (a) La nota de reversión, con su fecha, su motivo y el puntero a lo que la sustituye. Se
 * exigen las piezas por separado para que el fallo diga CUÁL falta en vez de un booleano.
 */
const PIEZAS_DE_LA_NOTA: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "el requisito por su nombre (R49)", patron: /\bR49\b/ },
  { nombre: "la feature que lo revierte (192 → 260)", patron: /\b260\b/ },
  { nombre: "la fecha de REVERSIÓN (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "que está revertida/superada", patron: /REVERTIDA|REVERSION|REVERSIÓN|SUPERSEDID/i },
  { nombre: "el motivo (mostrar TODOS los datos de la orden)", patron: /TODOS los datos/i },
  { nombre: "qué la sustituye (`ordenesColumns`)", patron: /\bordenesColumns\b/ },
  { nombre: "dónde sigue legible R49 (el spec de la 192)", patron: /specs\/192-tablero-dia-mensajeros/ },
];

const piezasDeLaNotaQueFaltan = (texto: string): string[] =>
  PIEZAS_DE_LA_NOTA.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);

/**
 * (b) Lo que el panel ya no puede HACER: declarar columnas por su cuenta. Se mide sobre el
 * código sin comentarios, así que la cita de la nota no cuenta.
 *
 * Dos formas de reincidir, y las dos se buscan: una constante tipada `Column<…>[]`, o un objeto
 * literal con la forma de una columna (`{ id: …, value: … }`) colado en el cuerpo del panel.
 */
const DECLARA_COLUMNAS = /:\s*Column\s*<|Column<[^>]*>\s*\[\s*\]\s*=|\bid\s*:\s*["'][^"']*["']\s*,\s*value\s*:/;
const declaraColumnas = (codigo: string): boolean => DECLARA_COLUMNAS.test(codigo);

/** (c) De dónde salen ahora: el panel CONSUME el módulo, no lo reimplementa. */
const consumeElModulo = (codigo: string): boolean => /\bcolumnasDetalle\s*\(/.test(codigo);

/* -------------------------------------------------------------------------- */
/* (2) El spec donde R49 se firmó                                              */
/* -------------------------------------------------------------------------- */

/** (d) El apéndice: fechado, con motivo y con el puntero a la ficha que lo revierte. */
const PIEZAS_DEL_APENDICE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la fecha del apéndice (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "que fue supersedida", patron: /supersedid/i },
  { nombre: "el puntero a la ficha 260", patron: /specs\/260-detalle-columnas-listado/ },
];

const piezasDelApendiceQueFaltan = (texto: string): string[] =>
  PIEZAS_DEL_APENDICE.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);

/**
 * (e) Las frases TESTIGO del R49 original, VERBATIM. Cubren las tres partes de aquella
 * decisión: el enunciado con su fecha de cierre, la enumeración de las cuatro columnas y la
 * exclusión explícita con su «ampliarlo después es aditivo».
 *
 * ⛔ Si una de éstas se pone roja, la respuesta NO es actualizar el testigo: es que alguien
 * reescribió R49 en vez de anexarle el apéndice.
 */
const TESTIGOS_DEL_R49_ORIGINAL: readonly string[] = [
  "**R49** *(cerrado el 2026-08-08)* — El detalle DEBE mostrar, por orden, las mismas",
  "columnas que el listado de órdenes: número de guía, estatus actual, resultado del día si",
  "lo hay, y destino/cliente en el mismo formato. NO DEBE añadir hora de la última gestión,",
  "monto recaudado ni motivo de reprogramación (ampliarlo después es aditivo).",
];

const testigosQueFaltan = (texto: string): string[] =>
  TESTIGOS_DEL_R49_ORIGINAL.filter((frase) => !texto.includes(frase));

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("(1) el panel declara R49 REVERTIDA y ya no declara columnas (R42)", () => {
  it("los tres archivos censados existen: la guardia mira lo que dice mirar", () => {
    for (const rel of [PANEL, MODULO_DE_COLUMNAS, SPEC_192]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
  });

  it("(a) la nota de reversión está, con su fecha, su motivo y su puntero", () => {
    expect(
      piezasDeLaNotaQueFaltan(leer(PANEL)),
      "R42: la decisión vieja no se borra, se SUSTITUYE con fecha y motivo. El docstring de " +
        "`COLUMNAS` enunciaba R49 con autoridad; si desapareciera sin dejar nada, el siguiente " +
        "que lea el panel no sabría que ahí hubo una decisión humana ni dónde sigue legible.",
    ).toEqual([]);
  });

  it("(b) el panel NO vuelve a declarar ninguna columna por su cuenta", () => {
    expect(
      declaraColumnas(quitarComentarios(leer(PANEL))),
      "El panel volvió a declarar columnas. Con eso la nota de reversión de arriba pasa a " +
        "mentir —dice que las columnas salen del módulo del listado— y las dos pantallas " +
        "vuelven a poder divergir, que es lo que la feature 260 vino a cerrar.",
    ).toBe(false);
  });

  it("(c) las columnas salen del módulo: el panel lo CONSUME", () => {
    expect(
      consumeElModulo(quitarComentarios(leer(PANEL))),
      "Sin esto la cláusula (b) sería verde por vacío: un panel que no monta ninguna tabla " +
        "tampoco declara columnas, y pasaría igual.",
    ).toBe(true);
  });
});

describe("(2) el spec de la 192 lleva el apéndice Y conserva su texto original (R42)", () => {
  it("(d) R49 apunta a la ficha 260, con fecha y motivo", () => {
    expect(
      piezasDelApendiceQueFaltan(leer(SPEC_192)),
      "R42: R49 se firmó en ese spec. Sin puntero, quien lo lea dentro de seis meses creerá " +
        "que el detalle sigue cerrado en cuatro columnas por decisión humana vigente.",
    ).toEqual([]);
  });

  it("(e) el texto original de R49 sigue VERBATIM: el apéndice no es una reescritura", () => {
    expect(
      testigosQueFaltan(leer(SPEC_192)),
      "Un spec es la foto de su momento. El apéndice se AÑADE; el texto original no se toca. " +
        "Si falta un testigo, alguien reescribió R49 para «dejarlo coherente» y con ello borró " +
        "la prueba de que aquel alcance se cerró a conciencia y con sus razones.",
    ).toEqual([]);
  });
});

describe("autocomprobación: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) exige TODAS las piezas: quitar una sola la delata", () => {
    const completa =
      "R49 queda REVERTIDA el 2026-08-21 por la feature 260: el humano pidió TODOS los datos " +
      "de la orden y ahora se monta `ordenesColumns`. R49 sigue legible en " +
      "`specs/192-tablero-dia-mensajeros/requirements.md`.";
    expect(piezasDeLaNotaQueFaltan(completa)).toEqual([]);
    // Sin la fecha, la nota diría «esto fue así» sin decir desde cuándo dejó de serlo.
    expect(piezasDeLaNotaQueFaltan(completa.replace("2026-08-21", "hace poco"))).toEqual([
      "la fecha de REVERSIÓN (2026-08-21)",
    ]);
    // Y sin el motivo, quien la lea puede revertirla de vuelta por no entenderla.
    expect(piezasDeLaNotaQueFaltan(completa.replace("TODOS los datos", "más datos"))).toEqual([
      "el motivo (mostrar TODOS los datos de la orden)",
    ]);
    expect(piezasDeLaNotaQueFaltan("un comentario cualquiera").length).toBe(
      PIEZAS_DE_LA_NOTA.length,
    );
  });

  it("(b) el detector de columnas caza LAS DOS formas de reincidir, y no la cita de la nota", () => {
    // Forma 1: la constante tipada, que es exactamente como estaba escrita hasta la 260.
    expect(declaraColumnas('const COLUMNAS: Column<OrdenDetalleDia>[] = [];')).toBe(true);
    // Forma 2: un objeto de columna colado suelto, sin tipar.
    expect(declaraColumnas('const extra = { id: "guia", value: "Nº Guía" };')).toBe(true);
    // Y NO marca lo que el panel sí puede hacer: montar el módulo.
    expect(declaraColumnas("columns={columnasDetalle(detalle?.alcance)}")).toBe(false);
    // La cita de la nota NO cuenta, porque el detector se aplica al código sin comentarios.
    const conCita = quitarComentarios(
      '// «las columnas del detalle, y NINGUNA mas»: R49, revertida.\nconst x = 1;',
    );
    expect(declaraColumnas(conCita)).toBe(false);
  });

  it("(c) el detector del consumo distingue la llamada de una mención vaga", () => {
    expect(consumeElModulo("columns={columnasDetalle(detalle.alcance)}")).toBe(true);
    expect(consumeElModulo("las columnas del detalle salen de otro sitio")).toBe(false);
  });

  it("(d) el apéndice sin puntero no cuela", () => {
    const bueno =
      "APÉNDICE — 2026-08-21: R49 fue SUPERSEDIDA. Ver `specs/260-detalle-columnas-listado/`.";
    expect(piezasDelApendiceQueFaltan(bueno)).toEqual([]);
    expect(piezasDelApendiceQueFaltan("APÉNDICE — 2026-08-21: R49 fue SUPERSEDIDA.")).toEqual([
      "el puntero a la ficha 260",
    ]);
  });

  it("(e) el detector de testigos cae si el original se reescribe, aunque sea «equivalente»", () => {
    const original = leer(SPEC_192);
    expect(testigosQueFaltan(original)).toEqual([]);
    // Una reescritura «coherente» del enunciado: cambia el sentido y el testigo lo caza.
    const reescrito = original.replace(
      "**R49** *(cerrado el 2026-08-08)* — El detalle DEBE mostrar, por orden, las mismas",
      "**R49** *(revertido el 2026-08-21)* — El detalle DEBE mostrar TODAS las",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaría midiendo el vacío
    expect(testigosQueFaltan(reescrito)).toEqual([
      "**R49** *(cerrado el 2026-08-08)* — El detalle DEBE mostrar, por orden, las mismas",
    ]);
  });

  it("los testigos NO son vacíos: hay cuatro y ninguno es la cadena vacía", () => {
    expect(TESTIGOS_DEL_R49_ORIGINAL).toHaveLength(4);
    for (const frase of TESTIGOS_DEL_R49_ORIGINAL) expect(frase.length).toBeGreaterThan(20);
  });
});
