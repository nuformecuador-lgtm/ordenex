import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

// Feature 265 (R27-R29) — GUARDIA DE QUE EL CODIGO NO MIENTA SOBRE POR QUE HACE LO QUE HACE.
//
// `traducirSecuencia` llevaba escrito, con autoridad, que «el proveedor no tiene motivo para
// saltarse paradas». El 2026-08-21 lo tuvo: contesto con seis paradas en `skippedShipments` y
// `skippedMandatoryShipmentCount = 6`. Esa premisa esta CADUCADA.
//
// Lo que se hizo con ella —y lo que esta guardia protege en las dos direcciones—:
//
//  (a) el RAZONAMIENTO que SIGUE VIVO («persistir una secuencia parcial seria peor que no
//      optimizar…») se conserva VERBATIM. Es la razon de la regla nueva, no un resto
//      historico: por eso la degradacion ordena TODAS las paradas y nunca persiste media.
//      ⛔ Si esta mitad se pone roja, la respuesta NO es actualizar el testigo: es que alguien
//      reescribio el razonamiento en vez de anexarle la nota.
//  (b) la premisa caducada NO se borra: se ANEXA una nota fechada, con motivo medido y
//      puntero a la ficha. Un comentario que ya no es cierto se anota, no se pisa (misma
//      practica que la 259 y la 261).
//  (c) y en TODO el arbol del optimizador no puede reaparecer una frase que afirme que el
//      proveedor no se salta paradas sin su nota al lado. Sin esta clausula, dentro de un ano
//      alguien vuelve a escribirla en otro archivo y el codigo vuelve a mentir.
//
// Cada detector es una funcion PURA y al final hay AUTOCOMPROBACION: se le da un texto que SI
// infringe y otro que no. Sin eso, una guardia de prosa se queda verde por vacia en cuanto un
// rename deja de encajar — y en este repo ya hubo una guardia que no podia fallar nunca.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

const CLIENTE = "lib/clients/google-route-optimization.ts";

/** El arbol del optimizador: donde podria reaparecer la premisa. */
const ARBOL_DEL_OPTIMIZADOR: readonly string[] = [
  CLIENTE,
  "lib/clients/fallback-route-optimization.ts",
  "lib/clients/haversine-route-optimization.ts",
  "lib/services/OptimizacionRutaService.ts",
  "lib/interfaces/external/IRouteOptimizationClient.ts",
];

function leer(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

/** Estos comentarios van partidos en varias lineas con sangria y `//`. */
function normalizar(texto: string): string {
  return texto
    .replace(/^\s*(\/\/|\*|\/\*\*?)/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* (a) El razonamiento que SOBREVIVE, verbatim                                 */
/* -------------------------------------------------------------------------- */

const TESTIGOS_DEL_RAZONAMIENTO: readonly string[] = [
  "Persistir una secuencia parcial seria peor que no optimizar",
  "borraria el ultimo orden bueno y dejaria paradas fuera de la ruta sin que nadie se entere",
];

const testigosQueFaltan = (texto: string): string[] => {
  const plano = normalizar(texto);
  return TESTIGOS_DEL_RAZONAMIENTO.filter((frase) => !plano.includes(frase));
};

/* -------------------------------------------------------------------------- */
/* (b) La nota anexada, con sus CINCO piezas                                   */
/* -------------------------------------------------------------------------- */

const PIEZAS_DE_LA_NOTA: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "el marcador `⏳ FEATURE 265`", patron: /⏳\s*FEATURE\s*265/ },
  { nombre: "la fecha de la nota (2026-08-22)", patron: /2026-08-22/ },
  { nombre: "la palabra que dice que esta superada (CADUCADA/SUPERSEDIDA)", patron: /CADUCAD|SUPERSEDID/i },
  {
    nombre: "el motivo MEDIDO (`skippedMandatoryShipmentCount = 6` el 2026-08-21)",
    patron: /skippedMandatoryShipmentCount\s*=\s*6[\s\S]{0,400}2026-08-21|2026-08-21[\s\S]{0,400}skippedMandatoryShipmentCount\s*=\s*6/,
  },
  {
    nombre: "el puntero a la ficha (`specs/265-optimizador-lee-al-proveedor`)",
    patron: /specs\/265-optimizador-lee-al-proveedor/,
  },
];

const piezasQueFaltan = (texto: string): string[] =>
  PIEZAS_DE_LA_NOTA.filter(({ patron }) => !patron.test(normalizar(texto))).map((p) => p.nombre);

/* -------------------------------------------------------------------------- */
/* (c) La premisa no puede reaparecer AFIRMADA                                 */
/* -------------------------------------------------------------------------- */

/**
 * Frases que afirman que el proveedor no se salta paradas. NO se prohiben del todo —la
 * original se conserva a proposito— pero cada aparicion tiene que llevar la nota de caducidad
 * CERCA: es lo que distingue «aqui esta escrito lo que se creia» de «aqui se afirma».
 */
const FRASES_DE_LA_PREMISA: readonly RegExp[] = [
  /no tiene motivo para saltarse paradas/i,
  /no puede saltarse paradas/i,
  /nunca se salta(ra)? (ninguna )?parada/i,
  /el proveedor (siempre )?sirve todas las paradas/i,
];

/** Cuantas lineas alrededor cuentan como «tiene la nota al lado». */
const RADIO_DE_LA_NOTA = 20;

const MARCADOR_DE_CADUCIDAD = /⏳\s*FEATURE\s*265|CADUCAD|SUPERSEDID/i;

/** Devuelve las apariciones de la premisa que NO llevan su nota cerca. */
function premisasAfirmadasSinNota(texto: string): string[] {
  const lineas = texto.split("\n");
  const huerfanas: string[] = [];
  for (const [i, linea] of lineas.entries()) {
    if (!FRASES_DE_LA_PREMISA.some((p) => p.test(linea))) continue;
    const contexto = lineas
      .slice(Math.max(0, i - RADIO_DE_LA_NOTA), i + RADIO_DE_LA_NOTA + 1)
      .join("\n");
    if (!MARCADOR_DE_CADUCIDAD.test(contexto)) huerfanas.push(linea.trim());
  }
  return huerfanas;
}

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("265/R27-R29 — la premisa caducada esta ANOTADA, no borrada ni reescrita", () => {
  it("los archivos censados existen: la guardia mira lo que dice mirar", () => {
    for (const rel of ARBOL_DEL_OPTIMIZADOR) {
      expect(fs.existsSync(path.join(RAIZ, rel)), `falta ${rel}`).toBe(true);
    }
  });

  it("(a) el razonamiento que sigue vivo esta VERBATIM", () => {
    expect(
      testigosQueFaltan(leer(CLIENTE)),
      "R27: «persistir una secuencia parcial seria peor que no optimizar» sigue siendo cierto " +
        "y es LA RAZON de que la degradacion ordene TODAS las paradas. Si falta un testigo, " +
        "alguien reescribio el razonamiento en vez de anexarle la nota de caducidad.",
    ).toEqual([]);
  });

  it("(b) la nota anexada esta completa, y el fallo dice CUAL pieza falta", () => {
    expect(
      piezasQueFaltan(leer(CLIENTE)),
      "R28: la premisa vieja no se borra, se ANOTA. Hacen falta el marcador de la ficha, la " +
        "fecha, la palabra que dice que esta superada, el motivo MEDIDO y el puntero al spec: " +
        "sin el motivo, el siguiente que lo lea la revierte por no entenderla.",
    ).toEqual([]);
  });

  it("(c) ninguna frase afirma la premisa sin su nota al lado, en todo el arbol", () => {
    const huerfanas = ARBOL_DEL_OPTIMIZADOR.flatMap((rel) =>
      premisasAfirmadasSinNota(leer(rel)).map((linea) => `${rel}: ${linea}`),
    );
    expect(
      huerfanas,
      "R29(c): el proveedor SI puede saltarse paradas, y lo hizo. Una frase que lo niegue sin " +
        "la nota de caducidad al lado vuelve a poner al lector en el error que costo 72 " +
        "eventos de cron en bucle.",
    ).toEqual([]);
  });
});

describe("autocomprobacion: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) el testigo cae si el razonamiento se reescribe, aunque sea «equivalente»", () => {
    const original = leer(CLIENTE);
    expect(testigosQueFaltan(original)).toEqual([]);

    const reescrito = original.replace(
      "Persistir una secuencia parcial seria peor que no optimizar",
      "No conviene guardar una secuencia incompleta",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaria midiendo el vacio
    expect(testigosQueFaltan(reescrito)).toEqual([TESTIGOS_DEL_RAZONAMIENTO[0]]);
  });

  it("(a bis) los testigos no son vacios ni triviales", () => {
    expect(TESTIGOS_DEL_RAZONAMIENTO).toHaveLength(2);
    for (const frase of TESTIGOS_DEL_RAZONAMIENTO) expect(frase.length).toBeGreaterThan(30);
  });

  it("(b) exige TODAS las piezas: quitar una sola la delata", () => {
    const completa =
      "// ⏳ FEATURE 265 (2026-08-22) — premisa CADUCADA: el 2026-08-21 el proveedor devolvio\n" +
      "// skippedMandatoryShipmentCount = 6 con el origen en otro pais.\n" +
      "// Puntero: specs/265-optimizador-lee-al-proveedor";
    expect(piezasQueFaltan(completa)).toEqual([]);

    expect(piezasQueFaltan(completa.replace("2026-08-22", "hace poco"))).toEqual([
      "la fecha de la nota (2026-08-22)",
    ]);
    expect(
      piezasQueFaltan(completa.replace("specs/265-optimizador-lee-al-proveedor", "el spec")),
    ).toEqual(["el puntero a la ficha (`specs/265-optimizador-lee-al-proveedor`)"]);
    expect(
      piezasQueFaltan(completa.replace("skippedMandatoryShipmentCount = 6", "varias paradas")),
    ).toEqual(["el motivo MEDIDO (`skippedMandatoryShipmentCount = 6` el 2026-08-21)"]);
    expect(piezasQueFaltan("// un comentario cualquiera")).toHaveLength(PIEZAS_DE_LA_NOTA.length);
  });

  it("(b bis) el detector NORMALIZA espacios: la nota partida en varias lineas cuela igual", () => {
    const partida =
      "// ⏳ FEATURE\n//   265 (2026-08-22) — CADUCADA. Medido el 2026-08-21:\n" +
      "//   skippedMandatoryShipmentCount = 6.\n//   specs/265-optimizador-lee-al-proveedor";
    expect(piezasQueFaltan(partida)).toEqual([]);
  });

  it("(c) marca la premisa HUERFANA y NO la que lleva su nota al lado", () => {
    const huerfana = "// el proveedor no tiene motivo para saltarse paradas, asi que si lo hace…";
    expect(premisasAfirmadasSinNota(huerfana)).toHaveLength(1);

    const anotada =
      "// el proveedor no tiene motivo para saltarse paradas.\n" +
      "// ⏳ FEATURE 265 (2026-08-22): la frase de arriba esta CADUCADA.";
    expect(premisasAfirmadasSinNota(anotada)).toEqual([]);

    // Y no marca una frase que hable de paradas sin negar nada.
    expect(
      premisasAfirmadasSinNota("// la secuencia devuelta debe cubrir todas las paradas enviadas"),
    ).toEqual([]);
  });

  it("(c bis) si alguien reintroduce la premisa en OTRO archivo del arbol, se marca", () => {
    // Se simula el arbol: el detector es puro, asi que se le puede dar el texto de otro
    // archivo con la frase pegada y comprobar que la caza.
    const otroArchivo = `${leer("lib/services/OptimizacionRutaService.ts")}\n// el proveedor no puede saltarse paradas`;
    expect(premisasAfirmadasSinNota(otroArchivo)).toHaveLength(1);
  });
});
