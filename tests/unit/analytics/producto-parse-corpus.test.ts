import { describe, it, expect } from "vitest";

import { parsearProducto } from "@/lib/analytics/producto-parse";

// Ficha 345 / T1.3 — LAS CADENAS REALES DE PRODUCCION (R12, R13, R14, R15, R23).
//
// ⚠ ESTE ARCHIVO ES EL QUE IMPIDE QUE EL CATALOGO SE INFLE. Esta medido contra produccion
// (2026-09-01): el parseo correcto da 855 lineas y **84 productos distintos**; la regex
// razonable con anticipacion —`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`— da **125**, o sea 41
// fantasmas, y con un sintoma concreto: produce un producto llamado `"Base Dr. 1 * BASE C"`,
// que son dos productos fundidos en uno.
//
// COMPROBADO A MANO (T1.3) que esa regex mala pone en ROJO los casos (a) y (c) de abajo:
//   - (a) `1 * Base Dr. 1 * BASE C.` le da UN item, no dos;
//   - (c) el nombre de ese item CONTIENE un `*`.
// Un test que tambien pasara con el parseo malo no probaria nada, asi que las dos aserciones
// existen para eso y no se pueden ablandar.
//
// Las cadenas van LITERALES, copiadas del dato de produccion. No se generan, no se componen y
// no se leen de un fixture: si alguien las "arregla", el corpus deja de ser el corpus.

/** Las cadenas TEXTUALES medidas en `orden.producto`, con el numero de items contado a mano. */
const CORPUS: readonly { texto: string; items: number; nombres: readonly string[] }[] = [
  {
    texto: "1 * Dr Melaxin. 1 * BASE C.",
    items: 2,
    nombres: ["Dr Melaxin", "BASE C"],
  },
  {
    // LA TRAMPA DEL PUNTO INTERNO: `Base Dr.` lleva el punto DENTRO del nombre.
    texto: "1 * Base Dr. 1 * BASE C.",
    items: 2,
    nombres: ["Base Dr", "BASE C"],
  },
  {
    texto: "2 * Base Dr. 1 * BASE C.",
    items: 2,
    nombres: ["Base Dr", "BASE C"],
  },
  {
    // LA TRAMPA DE LAS BARRAS: las barras verticales son parte del nombre. Esto es UN producto
    // mas otro, no cinco.
    texto:
      "1 * BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA. 3 * Dile Adiós a los Hongos | Aceite Milagroso 3X1.",
    items: 2,
    nombres: [
      "BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA",
      "Dile Adiós a los Hongos | Aceite Milagroso 3X1",
    ],
  },
  {
    texto: "1 * Oil Oregano l Aceite de Oregano Natural. 1 * BASE C.",
    items: 2,
    nombres: ["Oil Oregano l Aceite de Oregano Natural", "BASE C"],
  },
  {
    texto: "2 * Creatina Monohidratada. 1 * BASE C.",
    items: 2,
    nombres: ["Creatina Monohidratada", "BASE C"],
  },
  {
    texto: "1 * DEPILADOR MAGICO AFEITADO FACIL. 1 * BASE C.",
    items: 2,
    nombres: ["DEPILADOR MAGICO AFEITADO FACIL", "BASE C"],
  },
  { texto: "1 * Dr Melaxin", items: 1, nombres: ["Dr Melaxin"] },
  // Las TRES cadenas de PRUEBA medidas (7 ordenes de 768). No llevan marcador y NO deben
  // romper nada: cantidad 1 y el texto entero como nombre (R15).
  { texto: "PRUEBA", items: 1, nombres: ["PRUEBA"] },
  { texto: "PRUEBA 27 08 26", items: 1, nombres: ["PRUEBA 27 08 26"] },
  { texto: "Camiseta talla M", items: 1, nombres: ["Camiseta talla M"] },
];

describe("R23 · la tabla de casos reales: el numero de items se cuenta a mano", () => {
  for (const caso of CORPUS) {
    it(`«${caso.texto.slice(0, 60)}» produce ${caso.items} item(s)`, () => {
      const items = parsearProducto(caso.texto);
      expect(items).toHaveLength(caso.items);
      expect(items.map((i) => i.nombre)).toEqual(caso.nombres);
    });
  }
});

describe("R12 · (a) el punto DENTRO del nombre no parte el item", () => {
  // LA asercion que la regex con anticipacion NO pasa: ella devuelve UN item llamado
  // `Base Dr. 1 * BASE C`. Comprobado a mano en T1.3.
  it("`1 * Base Dr. 1 * BASE C.` produce EXACTAMENTE dos items", () => {
    const items = parsearProducto("1 * Base Dr. 1 * BASE C.");

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.nombre)).toEqual(["Base Dr", "BASE C"]);
    expect(items.map((i) => i.cantidad)).toEqual([1, 1]);
    // El fantasma medido, nombrado explicitamente: si vuelve, este caso lo dice.
    expect(items.map((i) => i.nombre)).not.toContain("Base Dr. 1 * BASE C");
  });

  it("con cantidad 2 delante, el reparto sigue siendo 2 y 1", () => {
    expect(parsearProducto("2 * Base Dr. 1 * BASE C.").map((i) => i.cantidad)).toEqual([2, 1]);
  });
});

describe("R13 · (b) las barras verticales NO parten: eso es UN producto", () => {
  it("la cadena de las barras produce EXACTAMENTE dos items", () => {
    const items = parsearProducto(
      "1 * BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA. 3 * Dile Adiós a los Hongos | Aceite Milagroso 3X1.",
    );

    expect(items).toHaveLength(2);
    // El primero conserva su nombre COMPLETO, barras incluidas.
    expect(items[0].nombre).toBe(
      "BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA",
    );
    expect(items[0].cantidad).toBe(1);
    expect(items[1].nombre).toBe("Dile Adiós a los Hongos | Aceite Milagroso 3X1");
    expect(items[1].cantidad).toBe(3);
  });

  it("un solo producto con barras es un solo item", () => {
    const items = parsearProducto(
      "1 * BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA.",
    );
    expect(items).toHaveLength(1);
  });
});

describe("R14 · (c) NINGUN nombre contiene el caracter `*`", () => {
  it("en todo el corpus real", () => {
    for (const caso of CORPUS) {
      for (const item of parsearProducto(caso.texto)) {
        expect(item.nombre, caso.texto).not.toContain("*");
        expect(item.clave, caso.texto).not.toContain("*");
      }
    }
  });

  it("tampoco en los casos degenerados donde el `*` sobrevive a la particion", () => {
    const degenerados = ["0 * X", "*", "1 * A 0 * B", "*1", "0 * 0 * Z"];
    for (const texto of degenerados) {
      for (const item of parsearProducto(texto)) {
        expect(item.nombre, texto).not.toContain("*");
      }
    }
  });
});

describe("R15 · las cadenas sin marcador no rompen nada", () => {
  it("las tres de prueba dan un item de cantidad 1 con el texto entero", () => {
    for (const texto of ["PRUEBA", "PRUEBA 27 08 26", "Camiseta talla M"]) {
      expect(parsearProducto(texto), texto).toEqual([
        { cantidad: 1, nombre: texto, clave: texto.toLowerCase() },
      ]);
    }
  });
});

describe("R23 · el catalogo del corpus no se infla", () => {
  // La medicion de produccion en pequeño: los 11 textos de arriba contienen 11 productos
  // distintos. Con la regex mala saldrian mas, porque los dos items de cada linea multiproducto
  // se funden en uno NUEVO que no existe en el catalogo.
  it("el numero de claves distintas del corpus es exactamente 11", () => {
    const claves = new Set(CORPUS.flatMap((c) => parsearProducto(c.texto)).map((i) => i.clave));

    expect([...claves].sort()).toEqual([
      "base c",
      "base de colageno | maquillaje hidratante | base de alta cobertura",
      "base dr",
      "camiseta talla m",
      "creatina monohidratada",
      "depilador magico afeitado facil",
      "dile adiós a los hongos | aceite milagroso 3x1",
      "dr melaxin",
      "oil oregano l aceite de oregano natural",
      "prueba",
      "prueba 27 08 26",
    ]);
    expect(claves.size).toBe(11);
  });

  it("las lineas del corpus suman 18 items y 22 unidades", () => {
    const items = CORPUS.flatMap((c) => parsearProducto(c.texto));
    expect(items).toHaveLength(18);
    expect(items.reduce((suma, i) => suma + i.cantidad, 0)).toBe(22);
  });
});
