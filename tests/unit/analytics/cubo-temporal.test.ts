import { describe, it, expect } from "vitest";

import { granularidadDe, trocear, type CuboTemporal } from "@/lib/analytics/cubo-temporal";
import { resolverRango } from "@/lib/analytics/ranges";
import { TOPE_PUNTOS_SERIE } from "@/lib/analytics/types";
import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import type { RangoResuelto } from "@/lib/analytics/types";

// Feature 180 (T1.3) — tests del modulo PURO de troceo temporal.
//
// Cubren R10 (la clave es la fecha calendario CR del primer dia del cubo), R11 (toda
// frontera sale de `fecha-cr.ts` y los cubos cubren el rango exactamente), R18 (la regla
// de granularidad), R19 (el techo de puntos no se puede superar para NINGUN rango
// admisible por el borde), R21 (el primer cubo semanal recortado) y la mitad de R29 que
// no cubre el guardia de pureza: el determinismo y la ausencia de reloj.
//
// Los rangos se construyen SIEMPRE con `resolverRango({ preset: "personalizado", ... })`
// y nunca a mano: asi los tests miden exactamente la misma ventana que produce el borde,
// y si `resolverRango` cambiara de convencion estos casos se enterarian.

/* -------------------------------------------------------------------------- */
/* Utilidades de los casos                                                     */
/* -------------------------------------------------------------------------- */

/** Duracion de un dia, derivada de los helpers (no se escribe a mano ni en los tests). */
const UN_DIA_MS =
  inicioDelDiaSiguienteCREnUtc("2000-01-01").getTime() - inicioDelDiaCREnUtc("2000-01-01").getTime();

/** Fecha calendario CR `dias` dias despues de `fecha`. */
function masDias(fecha: string, dias: number): string {
  return fechaCalendarioCR(new Date(inicioDelDiaCREnUtc(fecha).getTime() + dias * UN_DIA_MS));
}

/**
 * Rango de EXACTAMENTE `dias` dias calendario CR inclusivos que empieza en `desde`.
 * Construido por el borde, no a mano (ver cabecera).
 */
function rangoDeDias(desde: string, dias: number): RangoResuelto {
  return resolverRango({ preset: "personalizado", desde, hasta: masDias(desde, dias - 1) });
}

/** Dia de la semana CR de una fecha: 1 = lunes ... 0 = domingo (convencion `getUTCDay`). */
function diaDeLaSemanaCR(fecha: string): number {
  return inicioDelDiaCREnUtc(fecha).getUTCDay();
}

/** El 2026-01-05 es LUNES; se usa como ancla legible de los casos parametricos. */
const LUNES = "2026-01-05";

/* -------------------------------------------------------------------------- */
/* R18 · la regla de granularidad                                              */
/* -------------------------------------------------------------------------- */

describe("R18 · la granularidad depende del tamano del rango y del tope de puntos", () => {
  const casos: ReadonlyArray<{ dias: number; esperada: "dia" | "semana" }> = [
    { dias: 1, esperada: "dia" },
    { dias: 61, esperada: "dia" },
    { dias: 62, esperada: "dia" },
    { dias: 63, esperada: "semana" },
    { dias: 365, esperada: "semana" },
    { dias: 366, esperada: "semana" },
  ];

  for (const { dias, esperada } of casos) {
    it(`un rango de ${dias} dias calendario CR se trocea por ${esperada}`, () => {
      expect(granularidadDe(rangoDeDias(LUNES, dias))).toBe(esperada);
    });
  }

  it("el limite exacto del tope se trocea por dia, y un dia mas ya por semana", () => {
    // Escrito contra la CONSTANTE y no contra el 62 literal: si el tope se moviera, el
    // caso se mueve con el en vez de quedarse mintiendo sobre un numero viejo.
    expect(granularidadDe(rangoDeDias(LUNES, TOPE_PUNTOS_SERIE))).toBe("dia");
    expect(granularidadDe(rangoDeDias(LUNES, TOPE_PUNTOS_SERIE + 1))).toBe("semana");
  });

  it("la granularidad no depende del dia de la semana en que empiece el rango", () => {
    for (let desplazamiento = 0; desplazamiento < 7; desplazamiento += 1) {
      const inicio = masDias(LUNES, desplazamiento);
      expect(granularidadDe(rangoDeDias(inicio, TOPE_PUNTOS_SERIE)), inicio).toBe("dia");
      expect(granularidadDe(rangoDeDias(inicio, TOPE_PUNTOS_SERIE + 1)), inicio).toBe("semana");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R19 · el techo de puntos no se puede superar                                */
/* -------------------------------------------------------------------------- */

describe("R19 · ningun rango admisible por el borde produce mas cubos que el tope", () => {
  for (const dias of [1, 61, 62, 63, 365, 366]) {
    it(`un rango de ${dias} dias produce como mucho ${TOPE_PUNTOS_SERIE} cubos`, () => {
      expect(trocear(rangoDeDias(LUNES, dias)).length).toBeLessThanOrEqual(TOPE_PUNTOS_SERIE);
    });
  }

  it("ningun tamano de 1 a 366 dias supera el tope, empiece el rango el dia que empiece", () => {
    // Este es el caso que demuestra el techo: barre TODOS los tamanos admisibles y los
    // siete dias de arranque posibles. Un troceo que se pasara aunque fuera en una sola
    // combinacion (p.ej. 366 dias empezando en martes, que es el peor caso semanal)
    // aparece aqui y no en produccion.
    const excedidos: string[] = [];
    for (let desplazamiento = 0; desplazamiento < 7; desplazamiento += 1) {
      const inicio = masDias(LUNES, desplazamiento);
      for (let dias = 1; dias <= 366; dias += 1) {
        const cubos = trocear(rangoDeDias(inicio, dias));
        if (cubos.length > TOPE_PUNTOS_SERIE) {
          excedidos.push(`${inicio} x ${dias}d -> ${cubos.length} cubos`);
        }
      }
    }
    expect(excedidos).toEqual([]);
  });

  it("un rango diario produce exactamente un cubo por dia calendario CR", () => {
    for (const dias of [1, 2, 30, 61, 62]) {
      expect(trocear(rangoDeDias(LUNES, dias)).length, `${dias} dias`).toBe(dias);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R10 · la clave es la fecha calendario CR del primer dia del cubo            */
/* -------------------------------------------------------------------------- */

// LIMITE CONOCIDO DE ESTE BLOQUE, ESCRITO EN VEZ DE ESCONDIDO (verificacion por mutacion
// del T1.3): emitir la clave como `desde.toISOString().slice(0, 10)` en lugar de
// `fechaCalendarioCR(desde)` NO pone rojo ningun caso de aqui, y no es que los casos sean
// flojos: es que las dos expresiones son IDENTICAS sobre el dominio real. Todo `desde` de
// un cubo es, por construccion, `inicioDelDiaCREnUtc(fecha)` = `${fecha}T06:00:00.000Z`, y
// las 06:00Z caen en la MISMA fecha en UTC y en CR. No existe entrada que las distinga.
// Esa mutacion la mata el guardia de texto que ya existe:
// `ranges-reuso.guardia.test.ts > "no construye fechas con toISOString().slice en
// lib/analytics"`, que es donde debe morir — porque el defecto no es un valor equivocado
// hoy, es una SEGUNDA definicion del dia CR esperando a que alguien pase por aqui un
// instante que no sea frontera de dia. Lo que si discrimina un comportamiento es el caso
// "la clave se lee en hora de Costa Rica y no en UTC dentro de la ventana del cubo": mata
// cualquier derivacion de la clave a partir de un instante INTERIOR al cubo.
describe("R10 · la clave de cada cubo es la fecha CR de su propio instante de inicio", () => {
  it("toda clave tiene forma YYYY-MM-DD y es la fecha calendario CR de su `desde`", () => {
    for (const rango of [rangoDeDias(LUNES, 62), rangoDeDias("2026-01-07", 200)]) {
      for (const cubo of trocear(rango)) {
        expect(cubo.clave).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(cubo.clave).toBe(fechaCalendarioCR(cubo.desde));
      }
    }
  });

  it("la clave del primer cubo es la fecha de inicio del rango, no otra", () => {
    for (const dias of [1, 62, 63, 366]) {
      const rango = rangoDeDias("2026-02-25", dias);
      expect(trocear(rango)[0].clave, `${dias} dias`).toBe(rango.desdeFecha);
    }
  });

  it("las claves cruzan fin de mes y fin de anio sin repetirse ni saltarse un dia", () => {
    // 2026-02-28 -> 2026-03-01 (febrero no bisiesto) y 2026-12-31 -> 2027-01-01.
    const finDeMes = trocear(rangoDeDias("2026-02-26", 5)).map((c) => c.clave);
    expect(finDeMes).toEqual(["2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);

    const finDeAnio = trocear(rangoDeDias("2026-12-30", 4)).map((c) => c.clave);
    expect(finDeAnio).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("la clave se lee en hora de Costa Rica y no en UTC dentro de la ventana del cubo", () => {
    // La trampa que R10 evita: `toISOString().slice(0, 10)` sobre un instante INTERIOR al
    // cubo emite el dia UTC, que a partir de las 18:00 CR ya es el dia siguiente. La clave
    // tiene que describir el dia CR de toda la ventana, y no lo hace por casualidad.
    const [cubo] = trocear(rangoDeDias("2026-07-15", 3));
    const ultimoInstante = new Date(cubo.hasta.getTime() - 1);

    expect(fechaCalendarioCR(cubo.desde)).toBe(cubo.clave);
    expect(fechaCalendarioCR(ultimoInstante)).toBe(cubo.clave);
    // ...y ese mismo instante leido en UTC ya es el dia SIGUIENTE: la clave no puede salir
    // de ahi.
    expect(ultimoInstante.toISOString().slice(0, 10)).not.toBe(cubo.clave);
  });

  it("no hay dos cubos con la misma clave y el orden es cronologico ascendente (R6)", () => {
    for (const dias of [1, 62, 63, 366]) {
      const cubos = trocear(rangoDeDias("2026-03-04", dias));
      const claves = cubos.map((c) => c.clave);
      expect(new Set(claves).size, `${dias} dias`).toBe(claves.length);
      expect([...claves].sort(), `${dias} dias`).toEqual(claves);
      for (let i = 1; i < cubos.length; i += 1) {
        expect(cubos[i].desde.getTime()).toBeGreaterThan(cubos[i - 1].desde.getTime());
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R21 · el primer cubo semanal empieza en el rango, no en el lunes anterior    */
/* -------------------------------------------------------------------------- */

describe("R21 · con granularidad semana el primer cubo se recorta al inicio del rango", () => {
  // 2026-01-07 es MIERCOLES; 200 dias fuerza granularidad `semana`.
  const INICIO_MIERCOLES = "2026-01-07";
  const rango = rangoDeDias(INICIO_MIERCOLES, 200);

  it("el rango de prueba empieza de verdad a mitad de semana y se trocea por semana", () => {
    expect(diaDeLaSemanaCR(INICIO_MIERCOLES)).toBe(3); // 3 = miercoles
    expect(granularidadDe(rango)).toBe("semana");
  });

  it("el primer cubo empieza en el inicio del rango y su clave es ESE dia, no el lunes", () => {
    const [primero] = trocear(rango);
    expect(primero.desde.getTime()).toBe(rango.desde.getTime());
    expect(primero.clave).toBe(INICIO_MIERCOLES);
    // El lunes anterior (2026-01-05) NO puede ser la clave: afirmaria contener dinero de
    // dias que el rango excluye.
    expect(primero.clave).not.toBe("2026-01-05");
  });

  it("el segundo cubo empieza el lunes siguiente y a partir de ahi todos son lunes", () => {
    const cubos = trocear(rango);
    expect(cubos[1].clave).toBe("2026-01-12");
    expect(diaDeLaSemanaCR(cubos[1].clave)).toBe(1);
    for (const cubo of cubos.slice(1)) {
      expect(diaDeLaSemanaCR(cubo.clave), cubo.clave).toBe(1);
    }
  });

  it("el primer cubo dura solo lo que falta hasta el lunes, no una semana entera", () => {
    const [primero] = trocear(rango);
    // De miercoles a lunes hay 5 dias.
    expect(primero.hasta.getTime() - primero.desde.getTime()).toBe(5 * UN_DIA_MS);
  });

  it("el ultimo cubo termina exactamente en el fin del rango, truncado si desborda", () => {
    for (const inicio of [LUNES, INICIO_MIERCOLES, "2026-01-11"]) {
      for (const dias of [63, 100, 365, 366]) {
        const r = rangoDeDias(inicio, dias);
        const cubos = trocear(r);
        expect(cubos[cubos.length - 1].hasta.getTime(), `${inicio} x ${dias}d`).toBe(
          r.hasta.getTime(),
        );
      }
    }
  });

  it("un rango semanal que empieza en lunes no produce un primer cubo degenerado", () => {
    const cubos = trocear(rangoDeDias(LUNES, 63));
    expect(cubos[0].clave).toBe(LUNES);
    expect(cubos[0].hasta.getTime() - cubos[0].desde.getTime()).toBe(7 * UN_DIA_MS);
  });
});

/* -------------------------------------------------------------------------- */
/* R11 · fronteras de dia CR, contiguas y cubriendo el rango exactamente        */
/* -------------------------------------------------------------------------- */

/** Las tres afirmaciones que sostienen la conservacion (R12) aguas abajo. */
function comprobarCierreExacto(rango: RangoResuelto, cubos: readonly CuboTemporal[]): void {
  expect(cubos.length).toBeGreaterThan(0);
  expect(cubos[0].desde.getTime()).toBe(rango.desde.getTime());
  expect(cubos[cubos.length - 1].hasta.getTime()).toBe(rango.hasta.getTime());
  for (let i = 1; i < cubos.length; i += 1) {
    expect(cubos[i].desde.getTime()).toBe(cubos[i - 1].hasta.getTime());
  }
  const duracionTotal = cubos.reduce((s, c) => s + (c.hasta.getTime() - c.desde.getTime()), 0);
  expect(duracionTotal).toBe(rango.hasta.getTime() - rango.desde.getTime());
}

describe("R11 · toda frontera es un inicio de dia de Costa Rica", () => {
  it("todo `desde` y todo `hasta` cae en T06:00:00.000Z, el 00:00 de pared de CR", () => {
    for (const dias of [1, 62, 63, 366]) {
      for (const cubo of trocear(rangoDeDias("2026-05-13", dias))) {
        expect(cubo.desde.toISOString(), `${dias} dias`).toMatch(/T06:00:00\.000Z$/);
        expect(cubo.hasta.toISOString(), `${dias} dias`).toMatch(/T06:00:00\.000Z$/);
      }
    }
  });

  it("las fronteras coinciden con las que emite fecha-cr para esa misma fecha", () => {
    for (const cubo of trocear(rangoDeDias("2026-05-13", 10))) {
      expect(cubo.desde.getTime()).toBe(inicioDelDiaCREnUtc(cubo.clave).getTime());
      expect(cubo.hasta.getTime()).toBe(inicioDelDiaSiguienteCREnUtc(cubo.clave).getTime());
    }
  });

  it("los cubos son contiguos, sin solape y cubren el rango entero exactamente", () => {
    // Este es el invariante del que depende R12 (conservacion): si los cubos dejaran un
    // hueco o se solaparan, la suma de las filas dejaria de ser el total de la vista.
    for (const inicio of [LUNES, "2026-01-07", "2026-01-11"]) {
      for (const dias of [1, 2, 62, 63, 100, 365, 366]) {
        const rango = rangoDeDias(inicio, dias);
        comprobarCierreExacto(rango, trocear(rango));
      }
    }
  });

  it("un rango de un solo dia produce un cubo que es el rango entero", () => {
    const rango = rangoDeDias("2026-05-13", 1);
    const cubos = trocear(rango);
    expect(cubos).toHaveLength(1);
    expect(cubos[0].clave).toBe("2026-05-13");
    comprobarCierreExacto(rango, cubos);
  });
});

/* -------------------------------------------------------------------------- */
/* R29 · el modulo es puro: determinista y sin reloj                            */
/* -------------------------------------------------------------------------- */

describe("R29 · el troceo es determinista y no depende del reloj", () => {
  it("dos llamadas con el mismo rango dan claves y fronteras identicas", () => {
    for (const dias of [1, 62, 63, 366]) {
      const rango = rangoDeDias("2026-01-07", dias);
      const forma = (cubos: readonly CuboTemporal[]) =>
        cubos.map((c) => [c.clave, c.desde.toISOString(), c.hasta.toISOString()]);
      expect(forma(trocear(rango)), `${dias} dias`).toEqual(forma(trocear(rango)));
      expect(granularidadDe(rango)).toBe(granularidadDe(rango));
    }
  });

  it("granularidadDe y trocear no aceptan un `now`: su unica entrada es el rango", () => {
    // Un segundo parametro de reloj convertiria el troceo en no determinista y romperia
    // R26 aguas arriba. La aridad declarada es la prueba mas barata de que no existe.
    expect(granularidadDe.length).toBe(1);
    expect(trocear.length).toBe(1);
  });

  it("dos rangos equivalentes resueltos en momentos distintos producen el mismo troceo", () => {
    const uno = resolverRango(
      { preset: "personalizado", desde: "2026-01-07", hasta: "2026-03-15" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const otro = resolverRango(
      { preset: "personalizado", desde: "2026-01-07", hasta: "2026-03-15" },
      new Date("2027-11-30T23:59:59.999Z"),
    );
    expect(trocear(uno).map((c) => c.clave)).toEqual(trocear(otro).map((c) => c.clave));
  });
});
