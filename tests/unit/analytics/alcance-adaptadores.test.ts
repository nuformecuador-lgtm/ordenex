import { describe, it, expect } from "vitest";
import { whereGestionOrden, whereOrden, whereRollup } from "@/lib/analytics/alcance-columnas";
import type { AlcanceDatos } from "@/lib/analytics/alcance";

// Feature 122 / T3.1 — R23 y R24: traduccion del alcance a fragmento de `where`.
//
// R24 es el caso delicado: `gestion_orden` TIENE una columna `mensajero_id` NOT NULL a
// mano, y usarla seria lo comodo. D3 lo prohibe: la unica fuente de verdad del mensajero
// de una orden es `orden.mensajero_asignado_id`, asi que los TRES recortes de gestiones
// pasan por la relacion `orden`.

const ALCANCES: readonly AlcanceDatos[] = [
  { tipo: "global" },
  { tipo: "zona", zonaId: "z1" },
  { tipo: "tienda", tiendaId: "t1" },
  { tipo: "mensajero", mensajeroId: "m1" },
];

describe("R23 · adaptador de `orden`", () => {
  it("traduce los cuatro tipos de alcance a las tres columnas canonicas de orden", () => {
    expect(whereOrden({ tipo: "global" })).toEqual({});
    expect(whereOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereOrden({ tipo: "tienda", tiendaId: "t1" })).toEqual({ tiendaId: "t1" });
    expect(whereOrden({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      mensajeroAsignadoId: "m1",
    });
  });

  it("el fragmento de global es vacio: no inventa condiciones", () => {
    expect(Object.keys(whereOrden({ tipo: "global" }))).toEqual([]);
  });
});

describe("R23 · adaptador del rollup analytics_daily", () => {
  it("traduce los cuatro tipos de alcance con el mismo vocabulario que orden", () => {
    expect(whereRollup({ tipo: "global" })).toEqual({});
    expect(whereRollup({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereRollup({ tipo: "tienda", tiendaId: "t1" })).toEqual({ tiendaId: "t1" });
    expect(whereRollup({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      mensajeroAsignadoId: "m1",
    });
  });
});

describe("R24 · adaptador de gestion_orden: SIEMPRE por la relacion orden", () => {
  it("recorta zona, tienda Y mensajero a traves de la relacion orden", () => {
    expect(whereGestionOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ orden: { zonaId: "z1" } });
    expect(whereGestionOrden({ tipo: "tienda", tiendaId: "t1" })).toEqual({
      orden: { tiendaId: "t1" },
    });
    expect(whereGestionOrden({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      orden: { mensajeroAsignadoId: "m1" },
    });
  });

  it("nunca recorta por gestion_orden.mensajeroId, aunque exista y sea NOT NULL (D3)", () => {
    for (const alcance of ALCANCES) {
      const fragmento = whereGestionOrden(alcance);
      expect(Object.keys(fragmento), JSON.stringify(alcance)).not.toContain("mensajeroId");
      expect(Object.keys(fragmento), JSON.stringify(alcance)).not.toContain("mensajero");
    }
  });

  it("ningun fragmento de ninguna tabla nombra mensajeroId fuera de la relacion orden", () => {
    for (const alcance of ALCANCES) {
      for (const fragmento of [whereOrden(alcance), whereGestionOrden(alcance), whereRollup(alcance)]) {
        expect(clavesPropias(fragmento), JSON.stringify(alcance)).not.toContain("mensajeroId");
      }
    }
  });

  it("el fragmento de global es vacio tambien en gestion_orden", () => {
    expect(whereGestionOrden({ tipo: "global" })).toEqual({});
  });
});

/** Claves del primer nivel: lo que el motor aplicaria sobre la propia tabla. */
function clavesPropias(fragmento: object): string[] {
  return Object.keys(fragmento);
}
