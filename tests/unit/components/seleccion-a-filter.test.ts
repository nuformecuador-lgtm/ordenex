import { describe, it, expect } from "vitest";

import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";
import { ordenFilterSchema } from "@/lib/types/orden";

// Feature 144 / TB3.2 (R58, R59) — traduccion de la seleccion agregada al `filter`.
// Los cinco casos de la tabla de `requirements.md > Trazabilidad` estan cubiertos, y
// cada salida se valida contra el ESQUEMA REAL del borde: si la traduccion mandara
// una lista vacia o preset+rango, el schema la rechazaria (R32/R40).

function aceptadoPorElBorde(filter: unknown) {
  return ordenFilterSchema.safeParse(filter).success;
}

describe("seleccionAFilter — filtros de catalogo (R58)", () => {
  it("R59: sin seleccion, el filter queda VACIO (no se añade ninguna clave)", () => {
    expect(seleccionAFilter({})).toEqual({});
  });

  it("R58: las claves de catalogo se traducen por IDENTIDAD, con sus listas de ids", () => {
    const filter = seleccionAFilter({
      zona_id: ["z1", "z2"],
      tienda_id: ["t1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
    });
    expect(filter).toEqual({
      zona_id: ["z1", "z2"],
      tienda_id: ["t1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R32: una lista VACIA se OMITE, nunca se manda como `[]` (el borde la rechazaria)", () => {
    const filter = seleccionAFilter({ zona_id: [], tienda_id: ["t1"] });
    expect(filter).not.toHaveProperty("zona_id");
    expect(filter).toEqual({ tienda_id: ["t1"] });
    expect(aceptadoPorElBorde(filter)).toBe(true);
    // Demostracion de por que se omite: mandarla vacia seria validation_error.
    expect(aceptadoPorElBorde({ zona_id: [] })).toBe(false);
  });
});

describe("seleccionAFilter — filtro de tiempo posicional (R58)", () => {
  it("R58: `[\"30d\",\"\",\"\"]` -> `created_preset`", () => {
    const filter = seleccionAFilter({ created: ["30d", "", ""] });
    expect(filter).toEqual({ created_preset: "30d" });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R58: `[\"\",\"D\",\"H\"]` -> `created_desde` + `created_hasta`", () => {
    const filter = seleccionAFilter({ created: ["", "2026-07-01", "2026-07-28"] });
    expect(filter).toEqual({
      created_desde: "2026-07-01",
      created_hasta: "2026-07-28",
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R58: `[\"\",\"D\",\"\"]` -> SOLO `created_desde` (rango abierto por arriba)", () => {
    const filter = seleccionAFilter({ created: ["", "2026-07-01", ""] });
    expect(filter).toEqual({ created_desde: "2026-07-01" });
    expect(filter).not.toHaveProperty("created_hasta");
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R58: `[\"\",\"\",\"H\"]` -> SOLO `created_hasta` (rango abierto por abajo)", () => {
    const filter = seleccionAFilter({ created: ["", "", "2026-07-28"] });
    expect(filter).toEqual({ created_hasta: "2026-07-28" });
    expect(filter).not.toHaveProperty("created_desde");
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R59: `[\"\",\"\",\"\"]` no deberia llegar, y si llega NO añade claves temporales", () => {
    expect(seleccionAFilter({ created: ["", "", ""] })).toEqual({});
  });

  it("R40: nunca se emiten preset y rango a la vez (el atajo gana la terna)", () => {
    // Estado imposible desde la UI (R10); la traduccion falla cerrada igualmente.
    const filter = seleccionAFilter({ created: ["30d", "2026-07-01", "2026-07-28"] });
    expect(filter).toEqual({ created_preset: "30d" });
    expect(aceptadoPorElBorde(filter)).toBe(true);
    expect(
      aceptadoPorElBorde({ created_preset: "30d", created_desde: "2026-07-01" }),
    ).toBe(false);
  });

  it("R43: las fechas viajan como `YYYY-MM-DD`, sin hora ni instante absoluto", () => {
    const filter = seleccionAFilter({ created: ["", "2026-07-01", ""] }) as {
      created_desde?: string;
    };
    expect(filter.created_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("seleccionAFilter — combinacion (R46, R58)", () => {
  it("R46: los filtros nuevos conviven con `status_id` en el mismo objeto", () => {
    const filter = {
      status_id: ["est-1"],
      ...seleccionAFilter({ zona_id: ["z1"], created: ["7d", "", ""] }),
    };
    expect(filter).toEqual({
      status_id: ["est-1"],
      zona_id: ["z1"],
      created_preset: "7d",
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R31: la traduccion no inventa claves fuera de la lista blanca del borde", () => {
    const filter = seleccionAFilter({
      zona_id: ["z1"],
      created: ["", "2026-07-01", ""],
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
    expect(Object.keys(filter).sort()).toEqual(["created_desde", "zona_id"]);
  });
});

describe("seleccionAFilter — reasignables (interruptor)", () => {
  it("marcado se traduce al booleano `true` del borde, no a la cadena \"true\"", () => {
    const filter = seleccionAFilter({ reasignables: ["true"] });
    expect(filter).toEqual({ reasignables: true });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("desmarcado no llega a la traduccion: sin clave, sin filtro", () => {
    expect(seleccionAFilter({})).toEqual({});
  });

  it("convive con el resto de claves en el mismo objeto", () => {
    const filter = seleccionAFilter({
      reasignables: ["true"],
      zona_id: ["z1"],
      created: ["", "2026-07-01", "2026-07-28"],
    });
    expect(filter).toEqual({
      reasignables: true,
      zona_id: ["z1"],
      created_desde: "2026-07-01",
      created_hasta: "2026-07-28",
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });
});

