import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  asignarPodio,
  formatearPct,
  ordenarAgregados,
  type AgregadoOrdenable,
} from "@/lib/ranking/orden-ranking";

// Feature 196 (T0.2) — el criterio UNICO de orden/podio/porcentaje, extraido de
// `RankingService`. Cubre R4 (orden totalmente determinista), R9 (bajo umbral: se lista sin
// posicion) y R10 (el porcentaje se deriva, no se persiste).

function agregado(
  mensajeroId: string,
  nombre: string,
  entregadas: number,
  asignadas: number,
): AgregadoOrdenable {
  return { mensajeroId, nombre, entregadas, asignadas };
}

const ids = (filas: readonly AgregadoOrdenable[]) => filas.map((f) => f.mensajeroId);

describe("ordenarAgregados — orden total y determinista (R4)", () => {
  it("ordena por pct desc, luego entregadas desc, luego nombre asc", () => {
    const filas = [
      agregado("m3", "Carlos", 3, 4), // 75.0
      agregado("m1", "Ana", 9, 10), // 90.0
      agregado("m2", "Beto", 10, 10), // 100.0
    ];
    expect(ids(ordenarAgregados(filas))).toEqual(["m2", "m1", "m3"]);
  });

  it("con el mismo pct manda quien tiene mas entregadas", () => {
    const filas = [
      agregado("m1", "Ana", 1, 2), // 50.0, 1 entrega
      agregado("m2", "Zoe", 2, 4), // 50.0, 2 entregas
    ];
    expect(ids(ordenarAgregados(filas))).toEqual(["m2", "m1"]);
  });

  it("con pct y entregadas iguales manda el nombre ascendente", () => {
    const filas = [agregado("mb", "Beto", 1, 2), agregado("ma", "Ana", 1, 2)];
    expect(ids(ordenarAgregados(filas))).toEqual(["ma", "mb"]);
  });

  it("los de pct indefinido (asignadas = 0) van al final, ordenados por nombre", () => {
    const filas = [
      agregado("m9", "Zulema", 0, 0),
      agregado("m8", "Aaron", 0, 0),
      agregado("m1", "Beto", 1, 10), // 10.0, pero DEFINIDO
    ];
    expect(ids(ordenarAgregados(filas))).toEqual(["m1", "m8", "m9"]);
  });

  it("empate TOTAL (pct, entregadas y nombre) se desempata por mensajeroId asc", () => {
    // Dos homonimos con metricas identicas: sin este desempate el orden lo decidiria el
    // motor y dos corridas del mismo dia podrian congelar podios distintos.
    const filas = [agregado("m-zz", "Ana Rojas", 5, 5), agregado("m-aa", "Ana Rojas", 5, 5)];
    expect(ids(ordenarAgregados(filas))).toEqual(["m-aa", "m-zz"]);
  });

  it("el mismo conjunto en cualquier orden de entrada produce SIEMPRE el mismo orden", () => {
    const filas = [
      agregado("m-zz", "Ana Rojas", 5, 5),
      agregado("m-aa", "Ana Rojas", 5, 5),
      agregado("m-kk", "Ana Rojas", 5, 5),
      agregado("m-bb", "Ana Rojas", 4, 4), // mismo pct, menos entregadas
      agregado("m-cc", "Sin datos", 0, 0),
    ];
    const esperado = ["m-aa", "m-kk", "m-zz", "m-bb", "m-cc"];
    expect(ids(ordenarAgregados(filas))).toEqual(esperado);
    expect(ids(ordenarAgregados([...filas].reverse()))).toEqual(esperado);
    // Dos corridas sobre los mismos datos: mismo orden (R4).
    expect(ids(ordenarAgregados(filas))).toEqual(ids(ordenarAgregados(filas)));
  });

  it("empate total en el PODIO: las tres posiciones son estables entre corridas", () => {
    const filas = [
      agregado("m-dd", "Ana Rojas", 5, 5),
      agregado("m-aa", "Ana Rojas", 5, 5),
      agregado("m-cc", "Ana Rojas", 5, 5),
      agregado("m-bb", "Ana Rojas", 5, 5),
    ];
    const podio = (entrada: readonly AgregadoOrdenable[]) =>
      asignarPodio(ordenarAgregados(entrada), 1)
        .filter((f) => f.posicion !== null)
        .map((f) => [f.posicion, f.agregado.mensajeroId]);
    expect(podio(filas)).toEqual([
      [1, "m-aa"],
      [2, "m-bb"],
      [3, "m-cc"],
    ]);
    expect(podio([...filas].reverse())).toEqual(podio(filas));
  });

  it("no muta el arreglo de entrada", () => {
    const filas = [agregado("m2", "Zoe", 10, 10), agregado("m1", "Ana", 1, 10)];
    const copia = [...filas];
    ordenarAgregados(filas);
    expect(filas).toEqual(copia);
  });
});

describe("asignarPodio — umbral y puestos (R9)", () => {
  it("bajo el umbral: se LISTA con puesto pero sin posicion de podio", () => {
    const ordenados = ordenarAgregados([
      agregado("m2", "Beto", 2, 2), // 100.0 pero solo 2 asignadas (< 3)
      agregado("m1", "Ana", 5, 5), // 100.0 y 5 asignadas (>= 3)
    ]);
    const filas = asignarPodio(ordenados, 3);
    const beto = filas.find((f) => f.agregado.mensajeroId === "m2");
    const ana = filas.find((f) => f.agregado.mensajeroId === "m1");
    expect(ana?.posicion).toBe(1);
    expect(beto?.posicion).toBeNull();
    expect(beto?.puesto).toBe(2); // sigue en la lista, con su puesto
  });

  it("el puesto es 1..N y cubre a TODOS, tengan podio o no", () => {
    const filas = asignarPodio(
      ordenarAgregados([
        agregado("m1", "Ana", 10, 10),
        agregado("m2", "Beto", 5, 10),
        agregado("m3", "Carlos", 0, 0),
      ]),
      1,
    );
    expect(filas.map((f) => f.puesto)).toEqual([1, 2, 3]);
    expect(filas.map((f) => f.posicion)).toEqual([1, 2, null]); // Carlos: pct indefinido
  });

  it("la posicion i la ocupa el i-esimo ELEGIBLE, saltando a los que no llegan al umbral", () => {
    const filas = asignarPodio(
      ordenarAgregados([
        agregado("m1", "Ana", 2, 2), // 100.0, 2 asignadas -> NO elegible (umbral 3)
        agregado("m2", "Beto", 9, 10), // 90.0, elegible
        agregado("m3", "Carlos", 8, 10), // 80.0, elegible
      ]),
      3,
    );
    expect(filas.map((f) => [f.agregado.mensajeroId, f.posicion])).toEqual([
      ["m1", null],
      ["m2", 1],
      ["m3", 2],
    ]);
  });

  it("solo hay 3 posiciones: el cuarto elegible se queda sin podio", () => {
    const filas = asignarPodio(
      ordenarAgregados([
        agregado("m1", "Ana", 10, 10),
        agregado("m2", "Beto", 9, 10),
        agregado("m3", "Carlos", 8, 10),
        agregado("m4", "Dora", 7, 10),
      ]),
      1,
    );
    expect(filas.map((f) => f.posicion)).toEqual([1, 2, 3, null]);
  });

  it("si nadie alcanza el umbral, nadie ocupa podio", () => {
    const filas = asignarPodio(ordenarAgregados([agregado("m1", "Ana", 1, 1)]), 5);
    expect(filas.map((f) => f.posicion)).toEqual([null]);
    expect(filas.map((f) => f.puesto)).toEqual([1]);
  });

  it("pct indefinido nunca ocupa podio aunque el umbral sea 0", () => {
    const filas = asignarPodio(ordenarAgregados([agregado("m1", "Ana", 0, 0)]), 0);
    expect(filas[0]?.posicion).toBeNull();
  });
});

describe("formatearPct — porcentaje derivado, nunca persistido (R10)", () => {
  it("sin denominador el porcentaje es null, no cero", () => {
    expect(formatearPct(0, 0)).toBeNull();
    expect(formatearPct(3, 0)).toBeNull();
  });

  it("100% se serializa como STRING con un decimal", () => {
    expect(formatearPct(5, 5)).toBe("100.0");
  });

  it.each([
    [9, 10, "90.0"],
    [3, 4, "75.0"],
    [1, 3, "33.3"],
    [2, 3, "66.7"],
    [0, 7, "0.0"],
    [12, 10, "120.0"], // asignada ayer y entregada hoy: pct > 100 es legitimo
  ])("%i/%i -> %s", (entregadas, asignadas, esperado) => {
    expect(formatearPct(entregadas, asignadas)).toBe(esperado);
  });

  it("devuelve string (o null), nunca number: el cliente no recalcula", () => {
    const pct = formatearPct(1, 3);
    expect(typeof pct).toBe("string");
    expect(formatearPct(1, 0)).toBeNull();
  });

  it("es el UNICO sitio del repo que aplica este redondeo (R10)", () => {
    // Guardia barata: si otro modulo de produccion vuelve a escribir el redondeo a mano,
    // el porcentaje del vivo y el del historico podrian divergir sin que nadie lo note.
    const raiz = path.resolve(__dirname, "../../..");
    const modulo = readFileSync(path.join(raiz, "lib/ranking/orden-ranking.ts"), "utf8");
    expect(modulo).toContain("Math.round((entregadas / asignadas) * 1000) / 10");
    const service = readFileSync(path.join(raiz, "lib/services/RankingService.ts"), "utf8");
    expect(service).not.toContain("* 1000) / 10");
    expect(service).toContain("formatearPct");
  });
});
