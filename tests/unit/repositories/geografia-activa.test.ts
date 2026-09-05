import { describe, it, expect } from "vitest";

import {
  SELECT_CADENA_CANTON,
  SELECT_CADENA_DISTRITO,
  WHERE_CANTON_DISPONIBLE,
  WHERE_DISTRITO_DISPONIBLE,
  WHERE_PROVINCIA_DISPONIBLE,
  disponibleDesdeCadena,
  disponibleDesdeCadenaCanton,
  estaDisponible,
} from "@/lib/repositories/_shared/geografia-activa";

// FICHA 374 (R7) — la disponibilidad efectiva es la CONJUNCION de la cadena, y se evalua.
//
// Las OCHO combinaciones de los tres flags, sin atajos: es una tabla de verdad y se escribe
// entera. La fila que mas importa es la tercera —distrito activo bajo canton inactivo—, porque es
// el estado que R10 declara REPRESENTABLE y que un `updateMany` de limpieza destruiria.

interface Caso {
  provincia: boolean;
  canton: boolean;
  distrito: boolean;
  esperado: boolean;
}

const OCHO: Caso[] = [
  { provincia: true, canton: true, distrito: true, esperado: true },
  { provincia: true, canton: true, distrito: false, esperado: false },
  { provincia: true, canton: false, distrito: true, esperado: false },
  { provincia: true, canton: false, distrito: false, esperado: false },
  { provincia: false, canton: true, distrito: true, esperado: false },
  { provincia: false, canton: true, distrito: false, esperado: false },
  { provincia: false, canton: false, distrito: true, esperado: false },
  { provincia: false, canton: false, distrito: false, esperado: false },
];

describe("374/R7 — `estaDisponible`: las 8 combinaciones de la cadena", () => {
  it.each(OCHO)(
    "provincia=$provincia canton=$canton distrito=$distrito -> $esperado",
    ({ provincia, canton, distrito, esperado }) => {
      expect(estaDisponible({ provincia, canton, distrito })).toBe(esperado);
    },
  );

  it("SOLO la combinacion de los tres en `true` da disponible", () => {
    // Control global: si alguien cambiara la conjuncion por una disyuncion, siete casos de arriba
    // caerian, pero este dice en una linea cuantos deberian sobrevivir.
    expect(OCHO.filter((c) => c.esperado)).toHaveLength(1);
  });
});

describe("374/R7 — un nivel ausente no participa (no es lo mismo que `false`)", () => {
  it("la cadena de un CANTON no tiene eslabon de distrito", () => {
    expect(estaDisponible({ provincia: true, canton: true })).toBe(true);
    expect(estaDisponible({ provincia: true, canton: false })).toBe(false);
    expect(estaDisponible({ provincia: false, canton: true })).toBe(false);
  });

  it("la cadena de una PROVINCIA es su propio flag", () => {
    expect(estaDisponible({ provincia: true })).toBe(true);
    expect(estaDisponible({ provincia: false })).toBe(false);
  });

  it("un distrito ACTIVO bajo un canton INACTIVO no esta disponible, y eso NO es un bug (R10)", () => {
    // R10 escrito como aserto: el estado es representable y significa «el distrito esta bien; su
    // canton se retiro». Nadie tiene que «corregirlo».
    expect(estaDisponible({ provincia: true, canton: false, distrito: true })).toBe(false);
  });
});

describe("374/R7 — `disponibleDesdeCadena` sobre la fila que proyecta Prisma", () => {
  it("compone los tres niveles de la fila proyectada", () => {
    expect(
      disponibleDesdeCadena({ activo: true, canton: { activo: true, provincia: { activo: true } } }),
    ).toBe(true);
    expect(
      disponibleDesdeCadena({ activo: true, canton: { activo: false, provincia: { activo: true } } }),
    ).toBe(false);
    expect(
      disponibleDesdeCadena({ activo: true, canton: { activo: true, provincia: { activo: false } } }),
    ).toBe(false);
    expect(
      disponibleDesdeCadena({ activo: false, canton: { activo: true, provincia: { activo: true } } }),
    ).toBe(false);
  });
});

describe("374/R11 — los fragmentos `where`/`select` son la UNICA forma del predicado", () => {
  // Literales a proposito: estos objetos SON el contrato con Prisma. Compararlos contra una
  // funcion que los construyera los dejaria siempre verdes.
  it("`WHERE_PROVINCIA_DISPONIBLE` mira solo su propio flag", () => {
    expect(WHERE_PROVINCIA_DISPONIBLE).toEqual({ activo: true });
  });

  it("`WHERE_CANTON_DISPONIBLE` sube UN eslabon", () => {
    expect(WHERE_CANTON_DISPONIBLE).toEqual({ activo: true, provincia: { activo: true } });
  });

  it("`WHERE_DISTRITO_DISPONIBLE` sube LOS DOS eslabones", () => {
    expect(WHERE_DISTRITO_DISPONIBLE).toEqual({
      activo: true,
      canton: { activo: true, provincia: { activo: true } },
    });
  });

  it("`SELECT_CADENA_DISTRITO` proyecta los tres flags y ningun otro campo", () => {
    expect(SELECT_CADENA_DISTRITO).toEqual({
      activo: true,
      canton: { select: { activo: true, provincia: { select: { activo: true } } } },
    });
  });

  it("`SELECT_CADENA_CANTON` proyecta los dos flags de su cadena", () => {
    expect(SELECT_CADENA_CANTON).toEqual({ activo: true, provincia: { select: { activo: true } } });
  });

  it("`disponibleDesdeCadenaCanton` compone los dos niveles del canton", () => {
    expect(disponibleDesdeCadenaCanton({ activo: true, provincia: { activo: true } })).toBe(true);
    expect(disponibleDesdeCadenaCanton({ activo: false, provincia: { activo: true } })).toBe(false);
    expect(disponibleDesdeCadenaCanton({ activo: true, provincia: { activo: false } })).toBe(false);
  });

  // Los dos `WHERE` son la version SQL del mismo predicado: si alguien cambiara uno sin el otro,
  // la lectura que recorta y la que proyecta dirian cosas distintas del mismo nodo.
  it("el `WHERE` y el `select` describen la MISMA cadena, nivel a nivel", () => {
    expect(Object.keys(WHERE_DISTRITO_DISPONIBLE)).toEqual(Object.keys(SELECT_CADENA_DISTRITO));
    expect(Object.keys(WHERE_CANTON_DISPONIBLE)).toEqual(Object.keys(SELECT_CADENA_CANTON));
  });
});
