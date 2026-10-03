import { describe, it, expect } from "vitest";

import { ValorNoSerializableError, deserializarDescarga, serializarDescarga } from "@/lib/utils/codec-descarga";

// Ficha 470 (T2.1, R8 parte de transporte) — el conjunto que viaja por Storage vuelve IGUAL: lo que una
// Server Action transporta (Date, bigint, anidados, arrays en orden, null, texto raro) sobrevive al
// codec, y lo que JSON perderia LANZA nombrando el tipo.

const ida = <T>(v: T): T => deserializarDescarga<T>(serializarDescarga(v));

describe("codec de descarga · ida y vuelta (R8)", () => {
  it("Date vuelve como Date con el mismo instante, tambien anidada y en arrays", () => {
    const f = new Date("2026-09-10T18:00:00.123Z");
    const r = ida({ createdAt: f, filas: [{ fecha: f }, { fecha: null }], anidado: { mas: { f } } });
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.createdAt.getTime()).toBe(f.getTime());
    expect(r.filas[0].fecha).toBeInstanceOf(Date);
    expect(r.filas[1].fecha).toBeNull();
    expect(r.anidado.mas.f.toISOString()).toBe("2026-09-10T18:00:00.123Z");
  });

  it("una Date en la raiz tambien vuelve como Date", () => {
    const f = new Date("2026-01-01T00:00:00.000Z");
    expect(ida(f)).toEqual(f);
  });

  it("bigint vuelve como bigint exacto (mas alla de Number.MAX_SAFE_INTEGER)", () => {
    const r = ida({ n: 9007199254740993n, lista: [1n, -2n] });
    expect(r.n).toBe(9007199254740993n);
    expect(r.lista).toEqual([1n, -2n]);
  });

  it("arrays conservan el orden; null, numeros, booleanos y strings raros sobreviven", () => {
    const v = {
      status: "ok",
      items: [3, 1, 2].map((n) => ({ n, txt: `"comillas" \\ barra\nsalto\ttab 🚚 ñ` })),
      vacio: [],
      nada: null,
      cero: 0,
      falso: false,
      decimal: "1234.50",
    };
    expect(ida(v)).toEqual(v);
  });

  it("un objeto que se PARECE a la etiqueta pero tiene mas claves no se transforma", () => {
    const v = { x: { __descarga_fecha__: "2026-01-01T00:00:00.000Z", otra: 1 } };
    expect(ida(v)).toEqual(v);
  });

  it("limite aceptado: una propiedad `undefined` llega ausente", () => {
    const r = ida({ a: 1, b: undefined as number | undefined });
    expect(r).toEqual({ a: 1 });
    expect("b" in r).toBe(false);
  });
});

describe("codec de descarga · lo desconocido lanza nombrando el tipo (K7)", () => {
  it.each([
    ["Map", { m: new Map([["a", 1]]) }],
    ["Set", { s: new Set([1]) }],
    ["function", { f: () => 1 }],
    ["symbol", { s: Symbol("x") }],
  ])("%s ⇒ ValorNoSerializableError", (tipo, valor) => {
    expect(() => serializarDescarga(valor)).toThrow(ValorNoSerializableError);
    expect(() => serializarDescarga(valor)).toThrow(new RegExp(`«${tipo}»`));
  });

  it("una instancia de clase (p. ej. un Decimal) lanza con su nombre", () => {
    class Decimal {
      constructor(readonly v: string) {}
    }
    expect(() => serializarDescarga({ monto: new Decimal("1.00") })).toThrow(/«Decimal»/);
  });

  it("una fecha invalida lanza (no viaja como null en silencio)", () => {
    expect(() => serializarDescarga({ f: new Date("no-es-fecha") })).toThrow(/Invalid Date/);
  });

  it("`undefined` en la raiz lanza: no hay conjunto que transportar", () => {
    expect(() => serializarDescarga(undefined)).toThrow(ValorNoSerializableError);
  });
});
