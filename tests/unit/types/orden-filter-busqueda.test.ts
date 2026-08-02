import { describe, it, expect } from "vitest";
import {
  BUSQUEDA_MAX_CHARS,
  BUSQUEDA_MIN_CHARS,
  listarOrdenesSchema,
  listarOrdenesCompletoSchema,
  ordenFilterSchema,
  ORDEN_FILTER_FIELDS,
} from "@/lib/types/orden";

// Feature 169 / T2.1 — el BORDE del termino de busqueda (R1, R3, R4, R19).
//
// Todo lo de aqui ocurre ANTES de construir el `where`: si el schema lanza, no hay
// consulta. Que el minimo de 3 caracteres viva en el schema —y no solo en la interfaz— es
// lo que impide que un cliente hecho a mano dispare un Seq Scan sobre la tabla mas grande
// del sistema tecleando una sola letra.

const filtro = (q: unknown) => listarOrdenesSchema.parse({ filter: { q } }).filter;

describe("whitelist (R1/R19)", () => {
  it("R1: `q` es una clave admitida del filter", () => {
    expect([...ORDEN_FILTER_FIELDS]).toContain("q");
    expect(filtro("juan")).toEqual({ q: "juan" });
  });

  it("R1: `q` es OPCIONAL — el filter sin termino sigue siendo valido", () => {
    expect(listarOrdenesSchema.parse({ filter: { status_id: "os-1" } }).filter).toEqual({
      status_id: "os-1",
    });
    expect(listarOrdenesSchema.parse({}).filter).toBeUndefined();
  });

  it("R19: la whitelist crecio en UNA clave, no se abrio", () => {
    // `.strict()` sigue siendo la unica defensa que impide que un nombre de columna
    // arbitrario alcance el motor de datos.
    expect(() => listarOrdenesSchema.parse({ filter: { busqueda: "juan" } })).toThrow();
    expect(() => listarOrdenesSchema.parse({ filter: { q: "juan", otra: 1 } })).toThrow();
    expect(() =>
      listarOrdenesSchema.parse({ filter: { q: "juan", busqueda_texto: "x" } }),
    ).toThrow();
  });
});

describe("longitud del termino (R3/R4)", () => {
  it("R3: menos de 3 caracteres es validation_error", () => {
    expect(() => filtro("a")).toThrow();
    expect(() => filtro("ab")).toThrow();
  });

  it("R3: los espacios NO cuentan — `\"  a  \"` es 1 caracter, no 5", () => {
    // `.trim()` va antes de `.min()`: si fuera al reves, dos espacios y una letra pasarian
    // el minimo y llegarian al trigram como un termino de UN caracter.
    expect(() => filtro("  a  ")).toThrow();
    expect(() => filtro("  ab ")).toThrow();
  });

  it("exactamente 3 caracteres pasa (el minimo es inclusivo)", () => {
    expect(filtro("abc")).toEqual({ q: "abc" });
  });

  it("lo que llega al service ya viene RECORTADO", () => {
    expect(filtro("  juan perez  ")).toEqual({ q: "juan perez" });
  });

  it("R4: por encima del maximo es validation_error", () => {
    expect(filtro("x".repeat(BUSQUEDA_MAX_CHARS))).toEqual({
      q: "x".repeat(BUSQUEDA_MAX_CHARS),
    });
    expect(() => filtro("x".repeat(BUSQUEDA_MAX_CHARS + 1))).toThrow();
  });

  it("el termino vacio tambien es error (la ausencia se expresa OMITIENDO la clave)", () => {
    expect(() => filtro("")).toThrow();
    expect(() => filtro("   ")).toThrow();
  });

  it("solo admite texto: un numero o una lista se rechazan", () => {
    expect(() => filtro(12345)).toThrow();
    expect(() => filtro(["juan"])).toThrow();
    expect(() => filtro(null)).toThrow();
  });

  it("las constantes son las del diseño y se exportan para la interfaz", () => {
    // Un solo origen del 3: el schema y el control de texto leen la MISMA constante.
    expect(BUSQUEDA_MIN_CHARS).toBe(3);
    expect(BUSQUEDA_MAX_CHARS).toBe(80);
  });
});

describe("el resto del contrato del filter sigue intacto", () => {
  it("los dos refine temporales siguen aplicando con termino presente", () => {
    expect(() =>
      ordenFilterSchema.parse({ q: "juan", created_desde: "2026-07-10", created_hasta: "2026-07-01" }),
    ).toThrow();
    expect(() =>
      ordenFilterSchema.parse({ q: "juan", created_preset: "7d", created_desde: "2026-07-01" }),
    ).toThrow();
  });

  it("el termino combina con los demas filtros sin que ninguno anule al otro (R14)", () => {
    expect(
      ordenFilterSchema.parse({ q: "juan", zona_id: ["z1"], status_id: ["os-1"] }),
    ).toEqual({ q: "juan", zona_id: ["z1"], status_id: ["os-1"] });
  });

  it("el modo COMPLETO (descarga) hereda el mismo termino y los mismos limites (R20)", () => {
    // `listarOrdenesCompletoSchema` se DERIVA del del listado: reusar el schema es lo que
    // garantiza que la descarga no acepte un termino que el listado rechazaria.
    expect(listarOrdenesCompletoSchema.parse({ filter: { q: "juan" } }).filter).toEqual({
      q: "juan",
    });
    expect(() => listarOrdenesCompletoSchema.parse({ filter: { q: "ab" } })).toThrow();
    expect(() =>
      listarOrdenesCompletoSchema.parse({ filter: { q: "x".repeat(81) } }),
    ).toThrow();
  });
});
