import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  CREATED_PRESETS,
  listarOrdenesSchema,
  ordenFilterSchema,
  ORDEN_FILTER_FIELDS,
} from "@/lib/types/orden";
import { ordenesConfig } from "@/lib/config/ordenes";

// Feature 144/B1 (R30-R32, R38-R40, R43) — el borde del `filter` de `listarOrdenes`.
//
// Este schema es la UNICA defensa que impide que un nombre de columna o un valor
// arbitrario alcance el motor de datos. Todo lo de aqui abajo ocurre ANTES de construir
// el `where`: si el schema lanza, no hay consulta.

describe("ordenFilterSchema — whitelist ampliada (R30/R31)", () => {
  it("R30: la whitelist son exactamente estas claves (9 de la 144 + `reasignables` + `q`)", () => {
    // Este caso es un CENSO: enumera la whitelist entera para que ampliarla sea una
    // decision explicita y no un descuido. La feature 169 la amplio en UNA clave (`q`, el
    // termino de busqueda, su R1/R19) y por eso se actualiza aqui; el resto del archivo
    // —incluido "una clave desconocida sigue fallando"— no cambia.
    expect([...ORDEN_FILTER_FIELDS]).toEqual([
      "status_id",
      "zona_id",
      "tienda_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created_preset",
      "created_desde",
      "created_hasta",
      "reasignables",
      "q",
    ]);
  });

  it("`reasignables` solo admite `true`: 'sin filtro' se expresa OMITIENDO la clave", () => {
    expect(
      listarOrdenesSchema.parse({ filter: { reasignables: true } }).filter,
    ).toEqual({ reasignables: true });
    // `false` seria una tercera forma de decir "sin filtro" y se rechaza (falla cerrado).
    expect(() =>
      listarOrdenesSchema.parse({ filter: { reasignables: false } }),
    ).toThrow();
    expect(() =>
      listarOrdenesSchema.parse({ filter: { reasignables: "true" } }),
    ).toThrow();
  });

  it("R30: acepta las cinco claves de catalogo y las tres temporales", () => {
    const parsed = listarOrdenesSchema.parse({
      filter: {
        zona_id: ["z1"],
        tienda_id: ["t1", "t2"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        created_desde: "2026-07-01",
        created_hasta: "2026-07-28",
      },
    });
    expect(parsed.filter).toEqual({
      zona_id: ["z1"],
      tienda_id: ["t1", "t2"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      created_desde: "2026-07-01",
      created_hasta: "2026-07-28",
    });
  });

  it("R31: una clave fuera de la whitelist sigue produciendo ZodError (no llega a Prisma)", () => {
    expect(() => ordenFilterSchema.parse({ mensajero_id: ["m1"] })).toThrow(z.ZodError);
    // Ni el nombre INTERNO de una columna real que ahora si se filtra.
    expect(() => ordenFilterSchema.parse({ zonaId: ["z1"] })).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ createdAt: "2026-07-01" })).toThrow(z.ZodError);
  });
});

describe("ordenFilterSchema — filtros de catalogo (R32)", () => {
  const CATALOGOS = ["zona_id", "tienda_id", "provincia_id", "canton_id", "distrito_id"] as const;

  for (const clave of CATALOGOS) {
    it(`R32: ${clave} exige LISTA NO VACIA de ids no vacios`, () => {
      // Lista vacia: seria "ningun valor" y no puede degradar a "sin filtro".
      expect(() => ordenFilterSchema.parse({ [clave]: [] })).toThrow(z.ZodError);
      // Id vacio dentro de la lista.
      expect(() => ordenFilterSchema.parse({ [clave]: ["ok", ""] })).toThrow(z.ZodError);
      // No textual.
      expect(() => ordenFilterSchema.parse({ [clave]: [123] })).toThrow(z.ZodError);
      // El escalar NO se admite: la retrocompatibilidad escalar es solo de `status_id`.
      expect(() => ordenFilterSchema.parse({ [clave]: "z1" })).toThrow(z.ZodError);
      // Y la forma valida pasa.
      expect(ordenFilterSchema.parse({ [clave]: ["ok"] })).toEqual({ [clave]: ["ok"] });
    });
  }
});

describe("ordenFilterSchema — atajo de antiguedad (R38)", () => {
  it("R38: acepta cada valor del dominio cerrado", () => {
    for (const preset of CREATED_PRESETS) {
      expect(ordenFilterSchema.parse({ created_preset: preset })).toEqual({
        created_preset: preset,
      });
    }
  });

  it("R38: un valor fuera del dominio -> ZodError sin consulta", () => {
    expect(() => ordenFilterSchema.parse({ created_preset: "365d" })).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ created_preset: "" })).toThrow(z.ZodError);
  });

  it("R38: una LISTA de presets se rechaza (es un solo valor, no multi)", () => {
    expect(() => ordenFilterSchema.parse({ created_preset: ["7d"] })).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ created_preset: ["7d", "30d"] })).toThrow(z.ZodError);
  });
});

describe("ordenFilterSchema — rango de fechas (R39/R43)", () => {
  it("R39: exige el formato de fecha calendario YYYY-MM-DD", () => {
    expect(() => ordenFilterSchema.parse({ created_desde: "01/07/2026" })).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ created_desde: "2026-7-1" })).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ created_hasta: "ayer" })).toThrow(z.ZodError);
  });

  it("R43: NO acepta instantes absolutos del reloj del cliente", () => {
    // El borde temporal se calcula server-side: un ISO con hora/offset se rechaza.
    expect(() =>
      ordenFilterSchema.parse({ created_desde: "2026-07-01T00:00:00.000Z" }),
    ).toThrow(z.ZodError);
    expect(() => ordenFilterSchema.parse({ created_hasta: "2026-07-01T06:00:00-06:00" })).toThrow(
      z.ZodError,
    );
  });

  it("R39: el rango INVERTIDO (desde > hasta) -> ZodError sin consulta", () => {
    expect(() =>
      ordenFilterSchema.parse({ created_desde: "2026-07-28", created_hasta: "2026-07-01" }),
    ).toThrow(z.ZodError);
  });

  it("R39: desde === hasta es valido (un solo dia)", () => {
    expect(
      ordenFilterSchema.parse({ created_desde: "2026-07-15", created_hasta: "2026-07-15" }),
    ).toEqual({ created_desde: "2026-07-15", created_hasta: "2026-07-15" });
  });

  it("R39/R42: un solo extremo es valido (rango abierto por el otro lado)", () => {
    expect(ordenFilterSchema.parse({ created_desde: "2026-07-15" })).toEqual({
      created_desde: "2026-07-15",
    });
    expect(ordenFilterSchema.parse({ created_hasta: "2026-07-15" })).toEqual({
      created_hasta: "2026-07-15",
    });
  });
});

describe("ordenFilterSchema — atajo y rango son EXCLUYENTES (R40, falla cerrado)", () => {
  it("R40: preset + desde -> ZodError (no se aplica una precedencia silenciosa)", () => {
    expect(() =>
      ordenFilterSchema.parse({ created_preset: "30d", created_desde: "2026-07-01" }),
    ).toThrow(z.ZodError);
  });

  it("R40: preset + hasta -> ZodError", () => {
    expect(() =>
      ordenFilterSchema.parse({ created_preset: "30d", created_hasta: "2026-07-28" }),
    ).toThrow(z.ZodError);
  });

  it("R40: preset + rango completo -> ZodError", () => {
    const r = ordenFilterSchema.safeParse({
      created_preset: "7d",
      created_desde: "2026-07-01",
      created_hasta: "2026-07-28",
    });
    expect(r.success).toBe(false);
  });

  it("R40: el error viaja bajo una clave del filtro (fieldErrors utilizable)", () => {
    const r = ordenFilterSchema.safeParse({ created_preset: "30d", created_desde: "2026-07-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("created_preset"))).toBe(true);
    }
  });
});

describe("sin regresion del contrato previo (R45)", () => {
  it("R45: sin `filter`, el input parseado es el de siempre", () => {
    const parsed = listarOrdenesSchema.parse({});
    expect(parsed.filter).toBeUndefined();
    expect(parsed).toEqual({
      page: 1,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
      sortBy: "created_at",
      // Default vigente: `desc` por pedido humano (ver `listarOrdenesSchema`), la orden
      // mas reciente primero. Lo que R45 vigila es que sin `filter` el input parseado no
      // gane ni pierda claves, no cual era la direccion de ayer.
      sortDir: "desc",
    });
  });

  it("R45: `status_id` conserva la union escalar|lista", () => {
    expect(ordenFilterSchema.parse({ status_id: "os-a" })).toEqual({ status_id: "os-a" });
    expect(ordenFilterSchema.parse({ status_id: ["os-a", "os-b"] })).toEqual({
      status_id: ["os-a", "os-b"],
    });
    expect(() => ordenFilterSchema.parse({ status_id: [] })).toThrow(z.ZodError);
  });

  it("R46: `status_id` convive con los filtros nuevos en el mismo objeto", () => {
    expect(
      ordenFilterSchema.parse({ status_id: ["os-a"], zona_id: ["z1"], created_preset: "7d" }),
    ).toEqual({ status_id: ["os-a"], zona_id: ["z1"], created_preset: "7d" });
  });
});
