import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs";

import {
  LARGO_CODIGO_DTA,
  codigosDeLaTerna,
  parseGeografiaRows,
} from "@/scripts/seed-zonas";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 375 — LA CLAVE ESTABLE: LA DERIVACION POR PREFIJO Y EL ARTEFACTO QUE LA ALIMENTA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// DOS COSAS, y las dos son de las que fallan en silencio:
//
//   1. `codigosDeLaTerna` — la derivacion de los tres codigos a partir del del distrito. Un codigo
//      MAL FORMADO que se aceptara no encontraria ningun nodo y el seed CREARIA una fila: el
//      duplicado que esta ficha viene a cerrar, entrando por la puerta de al lado.
//
//   2. EL .xlsx REAL. `public/geografia-cr-completa.xlsx` es la fuente del cruce, y es un binario:
//      nadie lo revisa en un diff. Si alguien lo regenerara sin la columna `Codigo DTA`, o con los
//      codigos corridos, el seed caeria al respaldo por nombre SIN UN SOLO ERROR y el renombrado
//      volveria a duplicar. Este archivo lo LEE y lo comprueba.
//
// Los codigos verificados (Cabagra 60310, Pijije 50405, Duacari 70605, Puntarenas 6, Buenos Aires
// 603) y los tres HUECOS de la numeracion oficial vienen de
// `public/geografia-cr-completa-NOTAS.md`. Son literales a proposito: son EL CONTRATO con la DTA
// del IGN, no una copia de lo que produzca nuestro codigo.

const XLSX = path.join(process.cwd(), "public", "geografia-cr-completa.xlsx");

describe("375 — `codigosDeLaTerna`: los tres codigos salen del prefijo", () => {
  it("un codigo de distrito da provincia, canton y distrito", () => {
    expect(codigosDeLaTerna("60310")).toEqual({
      provincia: "6",
      canton: "603",
      distrito: "60310",
    });
    expect(codigosDeLaTerna("10101")).toEqual({
      provincia: "1",
      canton: "101",
      distrito: "10101",
    });
    expect(codigosDeLaTerna("70605")).toEqual({
      provincia: "7",
      canton: "706",
      distrito: "70605",
    });
  });

  it("recorta los espacios: una celda con espacios sigue siendo un codigo", () => {
    expect(codigosDeLaTerna("  50405 ")?.distrito).toBe("50405");
  });

  it("las longitudes declaradas son 1 / 3 / 5", () => {
    expect(LARGO_CODIGO_DTA).toEqual({ provincia: 1, canton: 3, distrito: 5 });
  });

  it.each([
    ["", "cadena vacia"],
    ["   ", "solo espacios"],
    ["9801", "cuatro digitos"],
    ["608103", "seis digitos"],
    ["6031O", "una letra colada (O por cero)"],
    ["60 310", "con un espacio dentro"],
    ["-0310", "con signo"],
    ["6031.0", "con punto"],
  ])("«%s» (%s) NO es un codigo DTA: devuelve null", (crudo) => {
    // Ante la duda `null`, no un cruce con nada: un codigo que no encuentra nodo hace que el seed
    // CREE una fila, que es exactamente el duplicado que la ficha cierra.
    expect(codigosDeLaTerna(crudo)).toBeNull();
  });

  it("`null` y `undefined` tambien devuelven null", () => {
    expect(codigosDeLaTerna(null)).toBeNull();
    expect(codigosDeLaTerna(undefined)).toBeNull();
  });
});

describe("375 — el .xlsx REAL trae la columna `Codigo DTA` y la trae bien", () => {
  it("el archivo existe", () => {
    expect(fs.existsSync(XLSX)).toBe(true);
  });

  it("⭑ 494 filas, 494 codigos distintos, ninguno vacio ni mal formado", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("el .xlsx no tiene ninguna hoja");
    const filas = parseGeografiaRows(ws);

    // ANTI-VACUIDAD: sin esto, un archivo vacio dejaria todo lo de abajo verde.
    expect(filas).toHaveLength(494);

    const codigos = filas.map((f) => codigosDeLaTerna(f.codigoDta)?.distrito ?? null);
    const malos = filas.filter((f) => codigosDeLaTerna(f.codigoDta) === null);
    expect(
      malos.map((f) => `${f.provincia}/${f.canton}/${f.distrito}: «${f.codigoDta}»`),
      "una fila sin codigo (o con uno mal formado) cae al respaldo por nombre, y su renombrado " +
        "volveria a duplicarla en la siguiente corrida del seed",
    ).toEqual([]);
    expect(new Set(codigos).size).toBe(494);
  });

  it("⭑ los codigos verificados de la DTA estan donde deben, y los TRES huecos respetados", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("el .xlsx no tiene ninguna hoja");
    const porTerna = new Map(
      parseGeografiaRows(ws).map((f) => [`${f.provincia}::${f.canton}::${f.distrito}`, f.codigoDta]),
    );

    // Los del encargo, verificados contra la DTA 2026 del IGN.
    expect(porTerna.get("Puntarenas::Buenos Aires::Cabagra")).toBe("60310");
    expect(porTerna.get("Guanacaste::Bagaces::Pijije")).toBe("50405");
    expect(porTerna.get("Limón::Guácimo::Duacarí")).toBe("70605");

    // Los TRES huecos documentados: la numeracion NO es secuencial.
    expect(porTerna.get("Alajuela::Grecia::Tacares")).toBe("20305");
    expect(porTerna.get("Alajuela::Grecia::Puente de Piedra")).toBe("20307"); // salta el 20306
    expect(porTerna.get("Puntarenas::Puntarenas::Barranca")).toBe("60108");
    expect(porTerna.get("Puntarenas::Puntarenas::Isla del Coco")).toBe("60110"); // salta el 60109
    expect(porTerna.get("Puntarenas::Golfito::Golfito")).toBe("60701");
    expect(porTerna.get("Puntarenas::Golfito::Guaycará")).toBe("60703"); // salta el 60702

    // Y los codigos saltados NO se usan para ningun distrito.
    const todos = new Set([...porTerna.values()]);
    expect(todos.has("20306")).toBe(false);
    expect(todos.has("60109")).toBe(false);
    expect(todos.has("60702")).toBe(false);
  });

  it("los prefijos son coherentes: todo distrito de una provincia comparte su primer digito", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("el .xlsx no tiene ninguna hoja");
    const filas = parseGeografiaRows(ws);

    const porProvincia = new Map<string, Set<string>>();
    const porCanton = new Map<string, Set<string>>();
    for (const f of filas) {
      const c = codigosDeLaTerna(f.codigoDta);
      if (c === null) throw new Error(`fila sin codigo valido: ${f.distrito}`);
      (porProvincia.get(f.provincia) ?? porProvincia.set(f.provincia, new Set()).get(f.provincia)!).add(
        c.provincia,
      );
      const clave = `${f.provincia}::${f.canton}`;
      (porCanton.get(clave) ?? porCanton.set(clave, new Set()).get(clave)!).add(c.canton);
    }

    expect(porProvincia.size).toBe(7);
    expect(porCanton.size).toBe(84);
    for (const [provincia, codigos] of porProvincia) {
      expect(codigos.size, `${provincia} tiene mas de un codigo de provincia`).toBe(1);
    }
    for (const [canton, codigos] of porCanton) {
      expect(codigos.size, `${canton} tiene mas de un codigo de canton`).toBe(1);
    }
    // Los 7 codigos de provincia son 1..7, sin huecos ni repetidos.
    expect(
      [...porProvincia.values()].map((s) => [...s][0]).sort(),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });
});
