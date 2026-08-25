import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clavePar,
  nivelDeCascada,
  elegirPorCascada,
  whereCascada,
  type ParTarifa,
  type FilaCascada,
} from "@/lib/utils/cascada-tarifa";

// Feature 274 (T1.2) — la cascada de resolucion de tarifa, en su modulo PURO.
// Cada `describe` cita el requisito que fija. La "recencia" de una fila se modela como su
// posicion en el array de candidatas (el modulo NO ve `createdAt`, y ese es el punto de R5).

const T1 = "tienda-1";
const T2 = "tienda-2";
const ZA = "zona-a";
const ZB = "zona-b";

interface Fila extends FilaCascada {
  id: string;
}

const fila = (id: string, tiendaId: string | null, zonaId: string | null): Fila => ({
  id,
  tiendaId,
  zonaId,
});

const par = (tiendaId: string, zonaId: string | null): ParTarifa => ({ tiendaId, zonaId });

function resolver(filas: readonly Fila[], p: ParTarifa): Fila | null {
  return elegirPorCascada(filas, [p]).get(clavePar(p)) ?? null;
}

describe("R1 — la cascada elige por especificidad: nivel 1, luego 2, luego 3", () => {
  const nivel1 = fila("n1", T1, ZA);
  const nivel2 = fila("n2", T1, null);
  const nivel3 = fila("n3", null, ZA);

  it("resuelve la fila de nivel 1 (tienda + zona) cuando existe", () => {
    expect(nivelDeCascada(nivel1, par(T1, ZA))).toBe(1);
    expect(resolver([nivel1, nivel2, nivel3], par(T1, ZA))).toBe(nivel1);
  });

  it("resuelve la fila de nivel 2 (tienda, zona NULL) cuando no hay nivel 1", () => {
    expect(nivelDeCascada(nivel2, par(T1, ZA))).toBe(2);
    expect(resolver([nivel2, nivel3], par(T1, ZA))).toBe(nivel2);
  });

  it("resuelve la fila de nivel 3 (zona, tienda NULL) cuando no hay nivel 1 ni 2", () => {
    expect(nivelDeCascada(nivel3, par(T1, ZA))).toBe(3);
    expect(resolver([nivel3], par(T1, ZA))).toBe(nivel3);
  });

  it("no considera candidata una fila de otra tienda ni de otra zona", () => {
    expect(nivelDeCascada(fila("otra", T2, ZA), par(T1, ZA))).toBeNull();
    expect(nivelDeCascada(fila("otra", T1, ZB), par(T1, ZA))).toBeNull();
    expect(nivelDeCascada(fila("otra", null, ZB), par(T1, ZA))).toBeNull();
  });
});

describe("R2 — sin ninguno de los tres niveles resuelve null, y (NULL, NULL) no es un nivel", () => {
  it("devuelve null cuando ninguna candidata aplica al par", () => {
    const filas = [fila("ajena", T2, ZB), fila("ajena2", null, ZB)];
    expect(resolver(filas, par(T1, ZA))).toBeNull();
  });

  it("no toma la fila global (tiendaId NULL, zonaId NULL) como cuarto nivel", () => {
    const global = fila("global", null, null);
    expect(nivelDeCascada(global, par(T1, ZA))).toBeNull();
    expect(resolver([global], par(T1, ZA))).toBeNull();
  });

  it("con la global presente entre las candidatas, un par sin fila propia sigue en null", () => {
    const filas = [fila("global", null, null), fila("ajena", T2, ZA)];
    expect(resolver(filas, par(T1, ZA))).toBeNull();
  });

  it("la global tampoco es nivel para un par sin zona", () => {
    expect(nivelDeCascada(fila("global", null, null), par(T1, null))).toBeNull();
  });
});

describe("R3 — el nivel 1 gana aunque el nivel 2 sea mas reciente", () => {
  // La recencia se modela como orden de aparicion: la ultima es "la mas reciente".
  const nivel1 = fila("n1-vieja", T1, ZA);
  const nivel2 = fila("n2-reciente", T1, null);

  it("resuelve el nivel 1 con el nivel 2 creado despues (mas reciente al final)", () => {
    expect(resolver([nivel1, nivel2], par(T1, ZA))).toBe(nivel1);
  });

  it("resuelve el nivel 1 tambien con el nivel 2 primero en la lista", () => {
    expect(resolver([nivel2, nivel1], par(T1, ZA))).toBe(nivel1);
  });
});

describe("R4 — una tienda sin fila propia cobra la fila de zona (tienda_id NULL)", () => {
  it("resuelve la tarifa de zona para la tienda que no tiene nivel 1 ni nivel 2", () => {
    const deZona = fila("zona-a-global", null, ZA);
    const deOtraTienda = fila("otra-tienda", T2, ZA);
    expect(resolver([deZona, deOtraTienda], par(T1, ZA))).toBe(deZona);
  });

  it("deja de aplicar en cuanto la tienda tiene su propia fila de nivel 2", () => {
    const deZona = fila("zona-a-global", null, ZA);
    const propia = fila("propia", T1, null);
    expect(resolver([deZona, propia], par(T1, ZA))).toBe(propia);
  });
});

describe("R5 — la resolucion no depende del orden en que la base devuelva las filas", () => {
  const filas = [
    fila("global", null, null),
    fila("zona-a", null, ZA),
    fila("t1-sin-zona", T1, null),
    fila("t1-zona-a", T1, ZA),
    fila("t2-zona-b", T2, ZB),
  ];
  const pares = [par(T1, ZA), par(T1, ZB), par(T2, ZB), par(T2, ZA), par(T1, null)];

  it("el mismo conjunto de filas en orden invertido da la misma resolucion", () => {
    const directo = elegirPorCascada(filas, pares);
    const invertido = elegirPorCascada([...filas].reverse(), pares);

    for (const p of pares) {
      expect(invertido.get(clavePar(p))).toBe(directo.get(clavePar(p)));
    }
    expect([...invertido.keys()]).toEqual([...directo.keys()]);
  });

  it("no usa la posicion como desempate: el nivel manda sobre el orden", () => {
    const resueltas = elegirPorCascada(filas, pares);
    expect(resueltas.get(clavePar(par(T1, ZA)))?.id).toBe("t1-zona-a");
    expect(resueltas.get(clavePar(par(T1, ZB)))?.id).toBe("t1-sin-zona");
    expect(resueltas.get(clavePar(par(T2, ZA)))?.id).toBe("zona-a");
  });
});

describe("R6 — un par con zonaId null solo alcanza el nivel 2", () => {
  it("resuelve la fila de la tienda con zona NULL", () => {
    const nivel2 = fila("n2", T1, null);
    expect(nivelDeCascada(nivel2, par(T1, null))).toBe(2);
    expect(resolver([nivel2], par(T1, null))).toBe(nivel2);
  });

  it("ignora las filas de zona de la propia tienda (no hay nivel 1 sin zona)", () => {
    const conZona = fila("t1-zona-a", T1, ZA);
    expect(nivelDeCascada(conZona, par(T1, null))).toBeNull();
    expect(resolver([conZona], par(T1, null))).toBeNull();
  });

  it("ignora las filas de zona sin tienda (no hay nivel 3 sin zona)", () => {
    const deZona = fila("zona-a", null, ZA);
    expect(nivelDeCascada(deZona, par(T1, null))).toBeNull();
    expect(resolver([deZona, fila("global", null, null)], par(T1, null))).toBeNull();
  });

  it("resuelve null si la tienda no tiene fila de nivel 2, aunque tenga de nivel 1", () => {
    const filas = [fila("t1-zona-a", T1, ZA), fila("zona-a", null, ZA)];
    expect(resolver(filas, par(T1, null))).toBeNull();
  });
});

describe("R7 — resolucion en lote: una entrada por par pedido y un where de tres ramas", () => {
  it("devuelve una entrada por CADA par, incluidos los que no resuelven", () => {
    const filas = [fila("t1-zona-a", T1, ZA)];
    const pares = [par(T1, ZA), par(T2, ZB), par(T1, null)];
    const resueltas = elegirPorCascada(filas, pares);

    expect(resueltas.size).toBe(3);
    for (const p of pares) {
      expect(resueltas.has(clavePar(p))).toBe(true);
    }
    expect(resueltas.get(clavePar(par(T1, ZA)))?.id).toBe("t1-zona-a");
    expect(resueltas.get(clavePar(par(T2, ZB)))).toBeNull();
    expect(resueltas.get(clavePar(par(T1, null)))).toBeNull();
  });

  it("distingue el par sin zona del par con zona de la misma tienda", () => {
    expect(clavePar(par(T1, ZA))).not.toBe(clavePar(par(T1, null)));
    expect(clavePar(par(T1, ZA))).toBe(clavePar(par(T1, ZA)));
  });

  it("whereCascada con N pares produce EXACTAMENTE las tres ramas del design", () => {
    const pares = [par(T1, ZA), par(T2, ZB), par(T1, ZA), par(T2, null)];

    expect(whereCascada(pares)).toEqual({
      OR: [
        { tiendaId: { in: [T1, T2] }, zonaId: { in: [ZA, ZB] } },
        { tiendaId: { in: [T1, T2] }, zonaId: null },
        { tiendaId: null, zonaId: { in: [ZA, ZB] } },
      ],
    });
  });

  it("omite las ramas 1 y 3 cuando ningun par trae zona", () => {
    expect(whereCascada([par(T1, null), par(T2, null), par(T1, null)])).toEqual({
      OR: [{ tiendaId: { in: [T1, T2] }, zonaId: null }],
    });
  });

  it("con la lista de pares vacia devuelve un OR vacio (nadie pidio nada)", () => {
    expect(whereCascada([])).toEqual({ OR: [] });
    expect(elegirPorCascada([fila("t1-zona-a", T1, ZA)], []).size).toBe(0);
  });

  it("el where cubre todas las filas que la cascada puede llegar a elegir", () => {
    // Las tres ramas casan, respectivamente, con los niveles 1, 2 y 3 del mismo par.
    const [rama1, rama2, rama3] = whereCascada([par(T1, ZA)]).OR;
    expect(rama1).toEqual({ tiendaId: { in: [T1] }, zonaId: { in: [ZA] } });
    expect(rama2).toEqual({ tiendaId: { in: [T1] }, zonaId: null });
    expect(rama3).toEqual({ tiendaId: null, zonaId: { in: [ZA] } });
  });
});

describe("R8 — la regla vive en un modulo puro que ninguna superficie puede esquivar", () => {
  const fuente = readFileSync(
    path.join(process.cwd(), "lib", "utils", "cascada-tarifa.ts"),
    "utf8",
  );

  it("el fuente no importa @prisma/client (ni con comillas dobles ni simples)", () => {
    expect(fuente).not.toContain('from "@prisma/client"');
    expect(fuente).not.toContain("from '@prisma/client'");
    expect(fuente).not.toContain('require("@prisma/client")');
  });

  it("el fuente no importa nada de next ni del cliente de base de datos del repo", () => {
    expect(fuente).not.toContain('from "next');
    expect(fuente).not.toContain('from "@/lib/prisma"');
  });
});
