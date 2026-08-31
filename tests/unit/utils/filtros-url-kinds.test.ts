import { describe, it, expect } from "vitest";

import { seleccionDesdeUrl } from "@/lib/utils/filtros-url";
import { BOOLEAN_MARCADO, type FilterDef } from "@/components/shared/FilterComponent";

// Feature 335 / T1.3 — validacion por `kind` (R10-R14) y filtro sin ningun valor valido
// (R16). Se prueba a traves de `seleccionDesdeUrl` a proposito: lo que le importa al
// consumidor no es el valor devuelto por la funcion interna, sino si la clave APARECE o
// NO en la seleccion.

const MULTI: FilterDef = {
  key: "zona_id",
  label: "Zona",
  kind: "multi",
  options: [
    { value: "A", label: "A" },
    { value: "B", label: "B" },
  ],
};

const SINGLE: FilterDef = {
  key: "estado",
  label: "Estado",
  kind: "single",
  options: [
    { value: "pendiente", label: "Pendiente" },
    { value: "entregado", label: "Entregado" },
  ],
};

const BOOLEANO: FilterDef = { key: "urgente", label: "Urgente", kind: "boolean" };

const TEXTO: FilterDef = {
  key: "nota",
  label: "Nota",
  kind: "text",
  minChars: 3,
};

const RANGO: FilterDef = {
  key: "fecha",
  label: "Fecha",
  kind: "dateRange",
  options: [
    { value: "30d", label: "Ultimos 30 dias" },
    { value: "hoy", label: "Hoy" },
  ],
};

/** `kind` fuera del dominio soportado: llega por una `as` porque el tipo lo prohibe. */
const NO_SOPORTADO = {
  key: "raro",
  label: "Raro",
  kind: "slider",
} as unknown as FilterDef;

function seleccion(query: string, filtros: FilterDef[]) {
  return seleccionDesdeUrl(new URLSearchParams(query), filtros);
}

describe("kind multi (R14)", () => {
  it("R14 — conserva los valores declarados y descarta los que no estan en options", () => {
    expect(seleccion("zona_id=A,XYZ,B", [MULTI])).toEqual({ zona_id: ["A", "B"] });
  });

  it("R14/R16 — si ningun valor esta declarado, la clave no aparece en la seleccion", () => {
    expect(seleccion("zona_id=XYZ,QQQ", [MULTI])).toEqual({});
  });
});

describe("kind single (R12, R14)", () => {
  it("R12 — se queda con el PRIMER valor valido y descarta el resto", () => {
    expect(seleccion("estado=entregado,pendiente", [SINGLE])).toEqual({
      estado: ["entregado"],
    });
  });

  it("R12/R14 — salta los invalidos que preceden al primer valido", () => {
    expect(seleccion("estado=fantasma,pendiente", [SINGLE])).toEqual({
      estado: ["pendiente"],
    });
  });
});

describe("kind boolean (R11)", () => {
  it(`R11 — acepta unicamente "${BOOLEAN_MARCADO}"`, () => {
    expect(seleccion("urgente=true", [BOOLEANO])).toEqual({
      urgente: [BOOLEAN_MARCADO],
    });
  });

  it("R11/R16 — cualquier otro valor descarta el param", () => {
    expect(seleccion("urgente=false", [BOOLEANO])).toEqual({});
    expect(seleccion("urgente=1", [BOOLEANO])).toEqual({});
    expect(seleccion("urgente=", [BOOLEANO])).toEqual({});
  });
});

describe("kind text (R13)", () => {
  it("R13 — acepta el valor recortado cuando alcanza minChars", () => {
    expect(seleccion("nota=  hola  ", [TEXTO])).toEqual({ nota: ["hola"] });
  });

  it("R13/R16 — por debajo de minChars el param se descarta", () => {
    expect(seleccion("nota=ho", [TEXTO])).toEqual({});
  });

  it("R13 — el valor NO se parte por coma: un termino de busqueda puede llevarlas", () => {
    expect(seleccion("nota=hola%2C+mundo", [TEXTO])).toEqual({
      nota: ["hola, mundo"],
    });
  });
});

describe("kind dateRange (R10)", () => {
  it("R10 — acepta un atajo ofrecido en la terna `atajo,desde,hasta`", () => {
    expect(seleccion("fecha=30d,,", [RANGO])).toEqual({ fecha: ["30d", "", ""] });
  });

  it("R10 — acepta un rango YYYY-MM-DD sin atajo, con las tres posiciones intactas", () => {
    expect(seleccion("fecha=,2026-07-01,2026-07-28", [RANGO])).toEqual({
      fecha: ["", "2026-07-01", "2026-07-28"],
    });
  });

  it("R10 — rechaza una fecha mal formada o inexistente", () => {
    expect(seleccion("fecha=,01-07-2026,", [RANGO])).toEqual({});
    expect(seleccion("fecha=,2026-13-45,", [RANGO])).toEqual({});
    expect(seleccion("fecha=,2026-02-31,", [RANGO])).toEqual({});
  });

  it("R10 — rechaza un atajo que no esta entre los ofrecidos", () => {
    expect(seleccion("fecha=siglo,,", [RANGO])).toEqual({});
  });

  it("R10 — rechaza el rango invertido, la terna entera", () => {
    expect(seleccion("fecha=,2026-07-28,2026-07-01", [RANGO])).toEqual({});
  });

  it("R10/R16 — la terna con las tres posiciones vacias se trata como ausente", () => {
    expect(seleccion("fecha=,,", [RANGO])).toEqual({});
    expect(seleccion("fecha=", [RANGO])).toEqual({});
  });
});

describe("lo que no se entiende (R16)", () => {
  it("R16 — un kind no soportado se descarta", () => {
    expect(seleccion("raro=7", [NO_SOPORTADO])).toEqual({});
  });

  it("R16 — un filtro sin ningun valor valido no aparece, y los demas si", () => {
    const url = "zona_id=XYZ&estado=pendiente&cierre=abc";
    expect(seleccion(url, [MULTI, SINGLE])).toEqual({ estado: ["pendiente"] });
  });
});
