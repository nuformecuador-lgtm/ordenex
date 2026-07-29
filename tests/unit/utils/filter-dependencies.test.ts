import { describe, it, expect } from "vitest";

import {
  opcionesVisibles,
  podarSeleccion,
  seleccionEfectiva,
  type FilterDependencyDef,
  type FilterDependencySelection,
} from "@/lib/utils/filter-dependencies";

// Feature 144 / TA.1 (R23-R27) — motor de dependencias, BLOQUE A: SIN DOMINIO.
// Los filtros son de FANTASIA a proposito (color -> talla -> material): si para
// escribir un caso hiciera falta nombrar una provincia, la logica estaria en el
// lugar equivocado.

interface Opcion {
  value: string;
  label?: string;
  parentValue?: string;
}

const COLOR: FilterDependencyDef<Opcion> = {
  key: "color",
  kind: "multi",
  options: [{ value: "rojo" }, { value: "azul" }],
};

const TALLA: FilterDependencyDef<Opcion> = {
  key: "talla",
  kind: "multi",
  dependsOn: "color",
  options: [
    { value: "rojo-s", parentValue: "rojo" },
    { value: "rojo-m", parentValue: "rojo" },
    { value: "azul-s", parentValue: "azul" },
  ],
};

const MATERIAL: FilterDependencyDef<Opcion> = {
  key: "material",
  kind: "multi",
  dependsOn: "talla",
  options: [
    { value: "rojo-s-lana", parentValue: "rojo-s" },
    { value: "rojo-m-lino", parentValue: "rojo-m" },
    { value: "azul-s-lana", parentValue: "azul-s" },
  ],
};

const CADENA = [COLOR, TALLA, MATERIAL];

function valores(opciones: Opcion[]): string[] {
  return opciones.map((o) => o.value);
}

describe("filter-dependencies — opcionesVisibles (R23, R24, R27)", () => {
  it("R23: un filtro SIN dependsOn ofrece todas sus opciones", () => {
    expect(valores(opcionesVisibles(CADENA, {}, "color"))).toEqual([
      "rojo",
      "azul",
    ]);
  });

  it("R24: con el padre SIN seleccion, el hijo ofrece todas las opciones asociadas a las del padre", () => {
    expect(valores(opcionesVisibles(CADENA, {}, "talla"))).toEqual([
      "rojo-s",
      "rojo-m",
      "azul-s",
    ]);
  });

  it("R24: con el padre SELECCIONADO, el hijo se acota a las opciones de esa seleccion", () => {
    const sel: FilterDependencySelection = { color: ["rojo"] };
    expect(valores(opcionesVisibles(CADENA, sel, "talla"))).toEqual([
      "rojo-s",
      "rojo-m",
    ]);
  });

  it("R24: la seleccion efectiva es la propia si no esta vacia, o las opciones visibles si lo esta", () => {
    expect([...seleccionEfectiva(CADENA, { color: ["azul"] }, "color")]).toEqual([
      "azul",
    ]);
    expect([...seleccionEfectiva(CADENA, {}, "color")]).toEqual(["rojo", "azul"]);
    // Hijo sin seleccion propia: su efectiva son sus VISIBLES (ya acotadas por el padre).
    expect([...seleccionEfectiva(CADENA, { color: ["azul"] }, "talla")]).toEqual([
      "azul-s",
    ]);
  });

  it("R25: el acotamiento es TRANSITIVO en una cadena de 3 niveles (abuelo acota al nieto)", () => {
    const sel: FilterDependencySelection = { color: ["rojo"] };
    expect(valores(opcionesVisibles(CADENA, sel, "material"))).toEqual([
      "rojo-s-lana",
      "rojo-m-lino",
    ]);
  });

  it("R25: acotar el nivel intermedio acota tambien al nieto", () => {
    const sel: FilterDependencySelection = { color: ["rojo"], talla: ["rojo-m"] };
    expect(valores(opcionesVisibles(CADENA, sel, "material"))).toEqual([
      "rojo-m-lino",
    ]);
  });

  it("R27: dependsOn a una clave NO declarada -> se comporta como filtro independiente", () => {
    const huerfano: FilterDependencyDef<Opcion> = {
      key: "acabado",
      dependsOn: "clave-que-no-existe",
      options: [{ value: "mate", parentValue: "x" }, { value: "brillo" }],
    };
    expect(valores(opcionesVisibles([COLOR, huerfano], {}, "acabado"))).toEqual([
      "mate",
      "brillo",
    ]);
  });

  it("una clave no declarada no tiene opciones (y no rompe)", () => {
    expect(opcionesVisibles(CADENA, {}, "inexistente")).toEqual([]);
  });

  it("una opcion sin parentValue no se ofrece mientras su padre acote", () => {
    const hijo: FilterDependencyDef<Opcion> = {
      key: "talla",
      dependsOn: "color",
      options: [{ value: "rojo-s", parentValue: "rojo" }, { value: "suelta" }],
    };
    expect(valores(opcionesVisibles([COLOR, hijo], { color: ["rojo"] }, "talla"))).toEqual(
      ["rojo-s"],
    );
  });

  it("un CICLO de dependencias no cuelga: se corta y se trata como independiente", () => {
    const a: FilterDependencyDef<Opcion> = {
      key: "a",
      dependsOn: "b",
      options: [{ value: "a1", parentValue: "b1" }],
    };
    const b: FilterDependencyDef<Opcion> = {
      key: "b",
      dependsOn: "a",
      options: [{ value: "b1", parentValue: "a1" }],
    };
    expect(valores(opcionesVisibles([a, b], {}, "a"))).toEqual(["a1"]);
    expect(valores(opcionesVisibles([a, b], {}, "b"))).toEqual(["b1"]);
  });
});

describe("filter-dependencies — podarSeleccion (R26)", () => {
  it("R26: al acotar el padre, el hijo pierde los valores que dejan de estar ofrecidos", () => {
    const sel: FilterDependencySelection = {
      color: ["rojo"],
      talla: ["rojo-s", "azul-s"],
    };
    expect(podarSeleccion(CADENA, sel)).toEqual({
      color: ["rojo"],
      talla: ["rojo-s"],
    });
  });

  it("R26: la poda es TRANSITIVA (el nieto se poda contra el hijo ya podado)", () => {
    const sel: FilterDependencySelection = {
      color: ["rojo"],
      talla: ["rojo-s", "azul-s"],
      material: ["rojo-s-lana", "azul-s-lana"],
    };
    expect(podarSeleccion(CADENA, sel)).toEqual({
      color: ["rojo"],
      talla: ["rojo-s"],
      material: ["rojo-s-lana"],
    });
  });

  it("R26/R18: una clave que se queda sin valores DESAPARECE del resultado", () => {
    const sel: FilterDependencySelection = {
      color: ["azul"],
      talla: ["rojo-s", "rojo-m"],
    };
    expect(podarSeleccion(CADENA, sel)).toEqual({ color: ["azul"] });
  });

  it("la poda es idempotente", () => {
    const sel: FilterDependencySelection = {
      color: ["rojo"],
      talla: ["rojo-s", "azul-s"],
      material: ["azul-s-lana"],
    };
    const unaVez = podarSeleccion(CADENA, sel);
    expect(podarSeleccion(CADENA, unaVez)).toEqual(unaVez);
  });

  it("no muta la seleccion recibida", () => {
    const sel: FilterDependencySelection = {
      color: ["rojo"],
      talla: ["rojo-s", "azul-s"],
    };
    podarSeleccion(CADENA, sel);
    expect(sel).toEqual({ color: ["rojo"], talla: ["rojo-s", "azul-s"] });
  });

  it("sin dependencias declaradas, la poda solo descarta claves vacias", () => {
    const sel: FilterDependencySelection = { color: ["rojo"], otro: [] };
    expect(podarSeleccion([COLOR], sel)).toEqual({ color: ["rojo"] });
  });

  it("un ciclo tampoco cuelga la poda", () => {
    const a: FilterDependencyDef<Opcion> = {
      key: "a",
      dependsOn: "b",
      options: [{ value: "a1", parentValue: "b1" }],
    };
    const b: FilterDependencyDef<Opcion> = {
      key: "b",
      dependsOn: "a",
      options: [{ value: "b1", parentValue: "a1" }],
    };
    expect(podarSeleccion([a, b], { a: ["a1"], b: ["b1"] })).toEqual({
      a: ["a1"],
      b: ["b1"],
    });
  });
});
