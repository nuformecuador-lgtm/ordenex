import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * FICHA 459 / T C.4 — GUARDIA de la lista de la reclasificacion (R80, R88).
 *
 * La migracion `20260925120300_reclasificar_cobros_459` lleva escrita, entre `-- LISTA-INICIO` y
 * `-- LISTA-FIN`, la lista de cobros que el humano aprobo fila a fila. Esta guardia exige que sea
 * EXACTAMENTE la de `progress/reclasificacion_459/lista_aprobada.csv`: mismos ids, mismos montos,
 * mismo numero y misma suma; que las constantes de control del `DO` digan lo mismo; que la tienda
 * aprobada sea la de la aprobacion; y que el `down.sql` borre esa MISMA lista. Si alguien toca una
 * fila en cualquiera de los tres sitios, el gate se pone rojo (R80). Y si el CSV no esta en el
 * repositorio, tambien (R88: sin lista aprobada registrada, no hay migracion).
 */

const RAIZ = process.cwd();
const DIR = join(RAIZ, "db/migrations/20260925120300_reclasificar_cobros_459");
const CSV = join(RAIZ, "progress/reclasificacion_459/lista_aprobada.csv");

/** Nuform en produccion: la unica tienda de los 203 (aprobacion del 2026-09-24). */
const TIENDA_APROBADA = "ecf6c289-9799-4558-be6d-ce5f8a12f5cd";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");

interface Fila {
  id: string;
  monto: string;
}

function filasDelCsv(texto: string): Fila[] {
  const [cabecera, ...lineas] = texto.trim().split("\n");
  if (cabecera !== "id,fecha_movimiento,monto") throw new Error(`cabecera inesperada: ${cabecera}`);
  return lineas.map((l) => {
    const [id, , monto] = l.split(",");
    return { id, monto };
  });
}

function tramo(texto: string): string {
  const i = texto.indexOf("-- LISTA-INICIO");
  const f = texto.indexOf("-- LISTA-FIN");
  if (i < 0 || f < i) throw new Error("faltan las marcas LISTA-INICIO / LISTA-FIN");
  return texto.slice(i + "-- LISTA-INICIO".length, f);
}

function filasDeLaMigracion(sql: string): Fila[] {
  return [...tramo(sql).matchAll(/\('([0-9a-f-]{36})',\s*(\d+\.\d{2})\)/g)].map((m) => ({ id: m[1], monto: m[2] }));
}

function idsDelDown(sql: string): string[] {
  return [...tramo(sql).matchAll(/'([0-9a-f-]{36})'/g)].map((m) => m[1]);
}

function control(sql: string): { n: string; suma: string; tienda: string } {
  const n = /n_esperados CONSTANT integer := (\d+);/.exec(sql)?.[1];
  const suma = /suma_esperada CONSTANT numeric\(14,2\) := (\d+\.\d{2});/.exec(sql)?.[1];
  const tienda = /tienda_aprobada CONSTANT text := '([0-9a-f-]{36})';/.exec(sql)?.[1];
  if (!n || !suma || !tienda) throw new Error("faltan las constantes de control");
  return { n, suma, tienda };
}

/** Suma exacta en centimos (BigInt): nunca `number` para dinero. */
function suma(filas: Fila[]): string {
  const c = filas.reduce((a, f) => a + BigInt(f.monto.replace(".", "")), 0n);
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}

/** La comparacion entera: `null` si cuadra, o la primera diferencia en palabras. */
function diferencia(csv: Fila[], migracion: Fila[]): string | null {
  if (csv.length !== migracion.length) return `filas: CSV ${csv.length}, migracion ${migracion.length}`;
  const porId = new Map(migracion.map((f) => [f.id, f.monto]));
  for (const f of csv) {
    if (!porId.has(f.id)) return `falta en la migracion ${f.id}`;
    if (porId.get(f.id) !== f.monto) return `monto distinto en ${f.id}: CSV ${f.monto}, migracion ${porId.get(f.id)}`;
  }
  if (suma(csv) !== suma(migracion)) return `suma: CSV ${suma(csv)}, migracion ${suma(migracion)}`;
  return null;
}

describe("459/C.4 — guardia: la lista de la reclasificacion = la lista aprobada", () => {
  const up = leer(join(DIR, "migration.sql"));
  const down = leer(join(DIR, "down.sql"));
  const csv = filasDelCsv(leer(CSV));

  it("R88: la lista aprobada esta en el repositorio: 203 filas, 203 ids distintos, 25 769 034,50", () => {
    expect(csv).toHaveLength(203);
    expect(new Set(csv.map((f) => f.id)).size).toBe(203);
    expect(suma(csv)).toBe("25769034.50");
  });

  it("R80: la lista de la migracion es EXACTAMENTE la del CSV (ids, montos, numero, suma)", () => {
    const migracion = filasDeLaMigracion(up);
    expect(migracion).toHaveLength(203);
    expect(diferencia(csv, migracion)).toBeNull();
    // Y en el MISMO orden que el CSV: una lista reordenada tambien es una lista tocada a mano.
    expect(migracion.map((f) => f.id)).toEqual(csv.map((f) => f.id));
  });

  it("R80: las constantes de control del DO dicen lo mismo, y la tienda es la aprobada", () => {
    expect(control(up)).toEqual({ n: "203", suma: "25769034.50", tienda: TIENDA_APROBADA });
  });

  it("R86: el down borra la MISMA lista, ni una mas ni una menos", () => {
    expect(idsDelDown(down)).toEqual(csv.map((f) => f.id));
  });

  it("contraprueba: una fila con otro monto, una de menos o un id cambiado ponen la guardia en rojo", () => {
    const migracion = filasDeLaMigracion(up);
    const otroMonto = migracion.map((f, i) => (i === 7 ? { ...f, monto: "1.00" } : f));
    expect(diferencia(csv, otroMonto)).toMatch(/monto distinto/);
    expect(diferencia(csv, migracion.slice(1))).toMatch(/filas/);
    const otroId = migracion.map((f, i) => (i === 0 ? { ...f, id: "00000000-0000-4000-8000-000000000000" } : f));
    expect(diferencia(csv, otroId)).toMatch(/falta en la migracion/);
    // Y sobre el TEXTO: cambiar un monto en el SQL cambia lo que la guardia lee.
    const primera = migracion[0];
    const tocado = up.replace(`('${primera.id}', ${primera.monto})`, `('${primera.id}', 0.01)`);
    expect(diferencia(csv, filasDeLaMigracion(tocado))).toMatch(/monto distinto/);
  });
});
