import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./_arbol-de-la-feature";

// Feature 259 (T2.4) — R21 y R26. **LA GUARDIA DE QUE EL CÓDIGO Y EL SPEC NO MIENTAN.**
//
// D10 («el tablero del día NO sigue al ranking», firmada el 2026-08-20) se REVIRTIÓ el
// 2026-08-21. Una decisión revertida vive en DOS soportes y los dos pueden envejecer por
// separado:
//
//   (1) `lib/repositories/TableroDiaRepository.ts` — su cabecera la explicaba como vigente y
//       con autoridad («dicho aquí para que nadie lo diagnostique como un bug»). Si ese texto
//       se queda mientras el `WHERE` cambia, el código miente al siguiente que lo lea.
//   (2) `specs/246-asignacion-por-dia/requirements.md` §D10 — donde se firmó. Sin marca, quien
//       lo lea dentro de seis meses creerá que sigue vigente.
//
// ⚠️ POR QUÉ LA MITAD (2) COMPRUEBA LAS DOS DIRECCIONES. Un spec es la foto de su momento:
// el apéndice APUNTA a la ficha nueva, pero el texto original **no se toca**. Si esta guardia
// solo exigiera el puntero, un «ya que estamos» podría reescribir §D10 para «dejarlo
// coherente» y borraría la única prueba de que aquella decisión se tomó a conciencia y con sus
// razones. Por eso se afirma también que las frases testigo siguen ahí VERBATIM.
//
// Cada detector es una función PURA y al final hay una AUTOCOMPROBACIÓN: se le da un texto que
// SÍ infringe y otro que no. Sin eso, una guardia de prosa puede quedarse verde por vacía —un
// patrón que dejó de encajar tras un rename se lee igual de verde que un árbol limpio.

const REPOSITORIO = "lib/repositories/TableroDiaRepository.ts";
const SPEC_246 = "specs/246-asignacion-por-dia/requirements.md";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/* -------------------------------------------------------------------------- */
/* (1) El repositorio                                                          */
/* -------------------------------------------------------------------------- */

/**
 * (a) Las frases que afirmaban D10 COMO VIGENTE. Ya no describen lo que hace la consulta:
 * desde la 259 una orden asignada hoy para mañana NO cuenta hoy en esta pantalla.
 */
const FRASES_SUPERADAS: readonly string[] = [
  "cuenta HOY en esta pantalla y MAÑANA en",
  "para que nadie lo diagnostique como un bug",
  "para que nadie la diagnostique como un bug",
  "Si algun dia se quiere alinearlas",
];

const frasesSuperadasQueQuedan = (texto: string): string[] =>
  FRASES_SUPERADAS.filter((frase) => texto.includes(frase));

/**
 * (b) La reversión, con sus DOS fechas y su motivo. Se exigen las piezas por separado para que
 * el fallo diga cuál falta en vez de un booleano.
 */
const PIEZAS_DE_LA_REVERSION: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la decisión por su nombre (D10)", patron: /\bD10\b/ },
  { nombre: "la fecha de FIRMA (2026-08-20)", patron: /2026-08-20/ },
  { nombre: "la fecha de REVERSIÓN (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "que está revertida/superada", patron: /REVERTIDA|SUPERADA|supersedid/i },
  { nombre: "la columna por la que cuenta ahora (`fecha_reparto`)", patron: /fecha_reparto/ },
  { nombre: "el motivo (el cubo `sinRecoger`)", patron: /sinRecoger/ },
];

const piezasQueFaltan = (texto: string): string[] =>
  PIEZAS_DE_LA_REVERSION.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);

/** (c) De dónde sale el predicado. Sin esta cita, el lector no sabe dónde está su porqué. */
const citaAlRanking = (texto: string): boolean => /\bRankingRepository\b/.test(texto);

/* -------------------------------------------------------------------------- */
/* (2) El spec donde D10 se firmó                                              */
/* -------------------------------------------------------------------------- */

/** (d) El apéndice: fechado, con motivo y con el puntero a la ficha que la revierte. */
const PIEZAS_DEL_APENDICE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la fecha del apéndice (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "que fue supersedida", patron: /supersedid/i },
  { nombre: "el puntero a la ficha 259", patron: /specs\/259-tablero-dia-por-reparto/ },
];

const piezasDelApendiceQueFaltan = (texto: string): string[] =>
  PIEZAS_DEL_APENDICE.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);

/**
 * (e) Las frases TESTIGO del §D10 original. Están elegidas para cubrir las tres partes de
 * aquella decisión —el enunciado, la firma y la consecuencia aceptada— y se comparan VERBATIM.
 *
 * ⛔ Si una de éstas se pone roja, la respuesta NO es actualizar el testigo: es que alguien
 * reescribió el spec de la 246 en vez de anexarle el apéndice.
 */
const TESTIGOS_DEL_D10_ORIGINAL: readonly string[] = [
  "**D10 · ¿El tablero del día sigue al ranking? [FIRMA] → FIRMADA EL 2026-08-20: NO LO SIGUE.**",
  "### D10 — FIRMADA el 2026-08-20: **el tablero del día NO sigue al ranking**",
  "orden asignada hoy para mañana **cuenta HOY en el tablero y MAÑANA en el ranking**. Ninguna de las",
  "**T6.7 queda `N/A`**: no se toca el CTE.",
];

const testigosQueFaltan = (texto: string): string[] =>
  TESTIGOS_DEL_D10_ORIGINAL.filter((frase) => !texto.includes(frase));

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("(1) el repositorio declara D10 REVERTIDA y no la afirma como vigente (R21)", () => {
  it("los dos archivos censados existen: la guardia mira lo que dice mirar", () => {
    for (const rel of [REPOSITORIO, SPEC_246]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
  });

  it("(a) ya no queda ninguna frase que afirme D10 como vigente", () => {
    expect(
      frasesSuperadasQueQuedan(leer(REPOSITORIO)),
      "Estas frases describían el criterio de D10 como deliberado y vigente. Desde la 259 el " +
        "tablero cuenta por día de reparto: una orden asignada hoy para mañana NO cuenta hoy " +
        "aquí. Dejarlas escritas hace que el código mienta, y miente con autoridad.",
    ).toEqual([]);
  });

  it("(b) la reversión está escrita con sus dos fechas y su motivo", () => {
    expect(
      piezasQueFaltan(leer(REPOSITORIO)),
      "R21: la decisión vieja no se borra, se SUSTITUYE con fecha y motivo. Hacen falta la " +
        "fecha de firma (2026-08-20), la de reversión (2026-08-21), la palabra que dice que " +
        "está superada, la columna por la que se cuenta ahora y el motivo (el cubo `sinRecoger`).",
    ).toEqual([]);
  });

  it("(c) cita `RankingRepository` como origen del predicado", () => {
    expect(
      citaAlRanking(leer(REPOSITORIO)),
      "El predicado de las dos ramas NO se inventa aquí: se copia del denominador de " +
        "`/ranking`, donde vive su razonamiento entero. Sin la cita, quien compare los dos " +
        "archivos y vea formas distintas creerá que miden cosas distintas.",
    ).toBe(true);
  });
});

describe("(2) el spec de la 246 lleva el apéndice Y conserva su texto original (R26)", () => {
  it("(d) §D10 apunta a la ficha 259, con fecha y motivo", () => {
    expect(
      piezasDelApendiceQueFaltan(leer(SPEC_246)),
      "R26: D10 se firmó en ese spec. Sin puntero, quien lo lea dentro de seis meses creerá " +
        "que el tablero sigue contando por `asignado_at`.",
    ).toEqual([]);
  });

  it("(e) el texto original de §D10 sigue VERBATIM: el apéndice no es una reescritura", () => {
    expect(
      testigosQueFaltan(leer(SPEC_246)),
      "Un spec es la foto de su momento. El apéndice se AÑADE; el texto original no se toca. " +
        "Si falta un testigo, alguien reescribió §D10 para «dejarlo coherente» y con ello " +
        "borró la prueba de que aquella decisión se tomó a conciencia y con sus razones.",
    ).toEqual([]);
  });
});

describe("autocomprobación: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) marca la frase superada y no marca la que la sustituye", () => {
    expect(
      frasesSuperadasQueQuedan(
        "una orden asignada hoy para mañana **cuenta HOY en esta pantalla y MAÑANA en `/ranking`**",
      ),
    ).toEqual(["cuenta HOY en esta pantalla y MAÑANA en"]);
    expect(
      frasesSuperadasQueQuedan("dicho aqui para que nadie lo diagnostique como un bug"),
    ).toEqual(["para que nadie lo diagnostique como un bug"]);
    expect(
      frasesSuperadasQueQuedan(
        "el universo del dia se determina por el DIA DE REPARTO (`orden.fecha_reparto`)",
      ),
    ).toEqual([]);
  });

  it("(b) exige TODAS las piezas: quitar una sola la delata", () => {
    const completo =
      "D10 se firmo el 2026-08-20 y queda REVERTIDA el 2026-08-21: razono sobre `asignadas` y " +
      "no sobre el cubo `sinRecoger`. Ahora cuenta por `fecha_reparto`.";
    expect(piezasQueFaltan(completo)).toEqual([]);
    // Sin la fecha de reversión, la nota diría «esto fue así» sin decir desde cuándo dejó de serlo.
    expect(piezasQueFaltan(completo.replace("2026-08-21", "hace poco"))).toEqual([
      "la fecha de REVERSIÓN (2026-08-21)",
    ]);
    // Y el motivo es lo que impide que alguien la revierta de vuelta por no entenderla.
    expect(piezasQueFaltan(completo.replace("`sinRecoger`", "un cubo"))).toEqual([
      "el motivo (el cubo `sinRecoger`)",
    ]);
    expect(piezasQueFaltan("un comentario cualquiera").length).toBe(PIEZAS_DE_LA_REVERSION.length);
  });

  it("(c) el detector de la cita distingue el nombre del archivo de una mención vaga", () => {
    expect(citaAlRanking("copiado de `RankingRepository.contarAsignadasPorMensajero`")).toBe(true);
    expect(citaAlRanking("igual que en el ranking, mas o menos")).toBe(false);
  });

  it("(d) el apéndice sin puntero no cuela", () => {
    const bueno =
      "APÉNDICE — 2026-08-21: D10 fue SUPERSEDIDA. Ver `specs/259-tablero-dia-por-reparto/`.";
    expect(piezasDelApendiceQueFaltan(bueno)).toEqual([]);
    expect(piezasDelApendiceQueFaltan("APÉNDICE — 2026-08-21: D10 fue SUPERSEDIDA.")).toEqual([
      "el puntero a la ficha 259",
    ]);
  });

  it("(e) el detector de testigos cae si el original se reescribe, aunque sea «equivalente»", () => {
    const original = leer(SPEC_246);
    expect(testigosQueFaltan(original)).toEqual([]);
    // Una reescritura «coherente» del enunciado: cambia el sentido y el testigo lo caza.
    const reescrito = original.replace(
      "### D10 — FIRMADA el 2026-08-20: **el tablero del día NO sigue al ranking**",
      "### D10 — REVERTIDA: **el tablero del día sigue al ranking**",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaría midiendo el vacío
    expect(testigosQueFaltan(reescrito)).toEqual([
      "### D10 — FIRMADA el 2026-08-20: **el tablero del día NO sigue al ranking**",
    ]);
  });

  it("los testigos NO son vacíos: hay cuatro y ninguno es la cadena vacía", () => {
    expect(TESTIGOS_DEL_D10_ORIGINAL).toHaveLength(4);
    for (const frase of TESTIGOS_DEL_D10_ORIGINAL) expect(frase.length).toBeGreaterThan(20);
  });
});
