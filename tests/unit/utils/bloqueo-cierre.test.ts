import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  CIERRE_ESTADOS_ABIERTOS,
  CIERRE_ESTADOS_RESOLICITABLES,
  esCierreAbierto,
  esCierreResolicitable,
  estaBloqueadoPorCierres,
  quienResuelve,
} from "@/lib/utils/bloqueo-cierre";

/**
 * FEATURE 271 (T1.1 — R2/R3/R4/R5/R6/R7/R8) — LA REGLA, dictada por el humano el 2026-08-23:
 *
 *      LIBRE si N <= 1 Y V = 0. En cualquier otro caso, BLOQUEADO.
 *
 * Las SIETE filas de la tabla de verdad de `requirements.md`, cada una con su `it` nombrado por el
 * caso que el humano dicto. Sin base de datos: la regla es aritmetica pura, y esa es toda la razon
 * por la que vive en un modulo sin Prisma (R10).
 *
 * ⚠️ ESTE ARCHIVO NO PRUEBA EL `WHERE` QUE PRODUCE N Y V. Eso es una consulta, y los tests de
 * servicio no ven el SQL: vive en `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, contra
 * Postgres y con contraprueba por mutacion.
 */
describe("271/T1.1 · la tabla de verdad de LIBRE/BLOQUEADO (R2-R8)", () => {
  it("caso 1 (R4) — sin cierres, gestionando hoy: N=0, V=0 -> LIBRE", () => {
    expect(estaBloqueadoPorCierres({ n: 0, v: 0 })).toBe(false);
  });

  it("caso 2 (R5) — termino el dia y solicito su cierre: N=1, V=0 -> LIBRE", () => {
    expect(estaBloqueadoPorCierres({ n: 1, v: 0 })).toBe(false);
  });

  it("caso 3 (R5) — trabaja hoy y el de ayer sigue sin aprobar: N=1, V=0 -> LIBRE", () => {
    // Es la MISMA aritmetica que el caso 2, y va aparte a proposito: es el caso que hace posible
    // el SEGUNDO cierre (R13) y el que produjo el incidente del cierre `79cb2c0f`. Colapsarlo con
    // el 2 escondería cual de los dos se rompio si alguien cambia la regla.
    expect(estaBloqueadoPorCierres({ n: 1, v: 0 })).toBe(false);
  });

  it("caso 4 (R6) — ya solicito el segundo: N=2, V=0 -> BLOQUEADO", () => {
    // La consecuencia asumida y dicha por el humano: aqui el mensajero queda bloqueado por una
    // demora que NO depende de el. «aunque esto no depende de él no importa igual queda bloqueado».
    expect(estaBloqueadoPorCierres({ n: 2, v: 0 })).toBe(true);
  });

  it("caso 5 (R7) — dejo vencer el unico: N=1, V=1 -> BLOQUEADO AL INSTANTE", () => {
    // ⚠️ ES EL CASO QUE UN TOPE A SECAS (`n > 1`) DARIA POR LIBRE. Por eso N y V son DOS numeros y
    // no uno (alternativa A3, descartada).
    expect(estaBloqueadoPorCierres({ n: 1, v: 1 })).toBe(true);
  });

  it("caso 6 (R8) — solicito el 1.º y dejo vencer el 2.º: N=2, V=1 -> BLOQUEADO", () => {
    expect(estaBloqueadoPorCierres({ n: 2, v: 1 })).toBe(true);
    // Y re-solicitar el vencido NO basta: sigue con N=2 (ahora V=0) y sigue bloqueado.
    expect(estaBloqueadoPorCierres({ n: 2, v: 0 })).toBe(true);
  });

  it("caso 7 (R3/R17/R18) — dos cierres rechazados: N=2, V=2 -> BLOQUEADO", () => {
    expect(estaBloqueadoPorCierres({ n: 2, v: 2 })).toBe(true);
  });

  it("sin tope (S9): con N=5 sigue bloqueado, y la regla no necesita un maximo", () => {
    // Q7 resuelta: SIN tope. Con el bloqueo puesto, N solo puede crecer por rechazos del
    // administrador, asi que esta acotado por construccion.
    expect(estaBloqueadoPorCierres({ n: 5, v: 3 })).toBe(true);
  });
});

describe("271/T1.1 · quien tiene la pelota (R43)", () => {
  it("un cierre re-solicitable lo resuelve EL MENSAJERO (lo reenvia el)", () => {
    expect(quienResuelve("vencido")).toBe("mensajero");
    expect(quienResuelve("rechazado")).toBe("mensajero");
  });

  it("un `solicitado` lo resuelve LA ADMINISTRACION (el mensajero ya hizo lo suyo)", () => {
    expect(quienResuelve("solicitado")).toBe("administracion");
  });
});

describe("271/T1.1 · las dos listas de estados (S1)", () => {
  it("ABIERTOS son los TRES que no son `aprobado` — el unico terminal", () => {
    expect([...CIERRE_ESTADOS_ABIERTOS]).toEqual(["solicitado", "vencido", "rechazado"]);
    expect(esCierreAbierto("aprobado")).toBe(false);
    for (const e of CIERRE_ESTADOS_ABIERTOS) expect(esCierreAbierto(e)).toBe(true);
  });

  it("RE-SOLICITABLES son `vencido` y `rechazado`: `rechazado` suma a V igual que `vencido` (S1)", () => {
    expect([...CIERRE_ESTADOS_RESOLICITABLES]).toEqual(["vencido", "rechazado"]);
    expect(esCierreResolicitable("solicitado")).toBe(false);
    expect(esCierreResolicitable("aprobado")).toBe(false);
  });

  it("V es SUBCONJUNTO de N: los re-solicitables estan todos entre los abiertos", () => {
    for (const e of CIERRE_ESTADOS_RESOLICITABLES) expect(esCierreAbierto(e)).toBe(true);
  });
});

describe("271/T1.1 · guardia — el modulo de la regla es PURO (R10)", () => {
  it("no importa nada de `@prisma/client` ni de la capa de datos", () => {
    // Es lo que permite que el servidor y la pantalla lean LA MISMA regla sin que la segunda
    // arrastre el cliente de base de datos ni tenga que re-derivarla.
    const fuente = readFileSync("lib/utils/bloqueo-cierre.ts", "utf8");
    expect(fuente).not.toMatch(/from "@prisma\/client"/);
    expect(fuente).not.toMatch(/lib\/repositories/);
  });
});
