import { describe, it, expect } from "vitest";
import {
  indexBy,
  lookup,
  normalize,
  resolveGeo,
  zonaDeDistrito,
  type CantonLike,
  type DistritoLike,
  type GeoResult,
  type ProvinciaLike,
} from "@/lib/utils/resolucion-geografica";

// Feature 248 (D12/R35) — ancla del util PURO extraido de `BulkOrdenService`.
//
// Dos cosas se afirman aqui, y las dos son el contrato del refactor:
//  1. `zonaDeDistrito` decide el distrito multi-zona en un solo sitio (los tres estados);
//  2. los mensajes de `fieldErrors` de `resolveGeo` siguen siendo CARACTER A CARACTER los
//     de la version privada, porque los tests de carga masiva y de carga por API los
//     afirman literalmente y no se tocan (R36).

const PROVINCIAS: ProvinciaLike[] = [
  { id: "p-sj", nombre: "San José" },
  { id: "p-car", nombre: "Cartago" },
];

const CANTONES: CantonLike[] = [
  { id: "c-central-sj", nombre: "Central", provinciaId: "p-sj" },
  { id: "c-central-car", nombre: "Central", provinciaId: "p-car" },
];

const DISTRITOS: DistritoLike[] = [
  {
    id: "d-carmen",
    nombre: "Carmen",
    cantonId: "c-central-sj",
    zonaId: "z-gam",
    esCentral: true,
  },
  {
    id: "d-sin-zona",
    nombre: "Sin Zona",
    cantonId: "c-central-sj",
    zonaId: null,
    esCentral: false,
  },
  {
    id: "d-oriental",
    nombre: "Oriental",
    cantonId: "c-central-car",
    zonaId: "z-resto",
    esCentral: false,
  },
];

function resolver(
  raw: { provincia: string; canton: string; distrito: string },
  opciones?: {
    provincias?: ProvinciaLike[];
    cantones?: CantonLike[];
    distritos?: DistritoLike[];
  },
): GeoResult {
  const provincias = opciones?.provincias ?? PROVINCIAS;
  const cantones = opciones?.cantones ?? CANTONES;
  const distritos = opciones?.distritos ?? DISTRITOS;
  return resolveGeo(
    raw,
    indexBy(provincias, (p) => normalize(p.nombre)),
    indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`),
    indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`),
  );
}

function erroresDe(resultado: GeoResult): Record<string, string[]> {
  if (resultado.ok) throw new Error("se esperaba un fallo de resolucion, hubo ok");
  return resultado.fieldErrors;
}

describe("zonaDeDistrito — una definicion para el distrito multi-zona (R35)", () => {
  it("devuelve unica con el id, el nombre y el flag de la zona cuando hay exactamente una", () => {
    expect(zonaDeDistrito([{ zonaId: "z-gam", nombre: "GAM", esCentral: true }])).toEqual({
      estado: "unica",
      zonaId: "z-gam",
      zonaNombre: "GAM",
      esCentral: true,
    });
  });

  it("devuelve ninguna cuando el distrito no tiene zonas asignadas", () => {
    expect(zonaDeDistrito([])).toEqual({ estado: "ninguna" });
  });

  it("devuelve ambigua con cuantas son cuando el distrito tiene mas de una zona, y no elige ninguna", () => {
    const resultado = zonaDeDistrito([
      { zonaId: "z-gam", nombre: "GAM", esCentral: true },
      { zonaId: "z-resto", nombre: "Resto del pais", esCentral: false },
    ]);
    expect(resultado).toEqual({ estado: "ambigua", cuantas: 2 });
    expect(JSON.stringify(resultado)).not.toContain("z-gam");
  });
});

describe("resolveGeo — resolucion del trio por nombre normalizado", () => {
  it("resuelve provincia, canton y distrito ignorando acentos, mayusculas y espacios sobrantes", () => {
    const resultado = resolver({
      provincia: "  san  jose ",
      canton: "CENTRAL",
      distrito: "cármen",
    });
    expect(resultado).toEqual({
      ok: true,
      geo: {
        provinciaId: "p-sj",
        zonaId: "z-gam",
        cantonId: "c-central-sj",
        distritoId: "d-carmen",
        esCentral: true,
      },
    });
  });

  it("acota el canton a su provincia: el mismo nombre en otra provincia resuelve otro canton", () => {
    const resultado = resolver({
      provincia: "Cartago",
      canton: "Central",
      distrito: "Oriental",
    });
    expect(resultado).toEqual({
      ok: true,
      geo: {
        provinciaId: "p-car",
        zonaId: "z-resto",
        cantonId: "c-central-car",
        distritoId: "d-oriental",
        esCentral: false,
      },
    });
  });
});

describe("resolveGeo — mensajes literales de fieldErrors (R36: los tests de carga los afirman)", () => {
  it("provincia inexistente: 'provincia no encontrada'", () => {
    expect(erroresDe(resolver({ provincia: "Limon", canton: "Central", distrito: "Carmen" })))
      .toEqual({ provincia: ["provincia no encontrada"] });
  });

  it("provincia duplicada: 'provincia ambigua'", () => {
    const errores = erroresDe(
      resolver(
        { provincia: "San José", canton: "Central", distrito: "Carmen" },
        {
          provincias: [
            { id: "p-sj", nombre: "San José" },
            { id: "p-sj-bis", nombre: "San Jose" },
          ],
        },
      ),
    );
    expect(errores).toEqual({ provincia: ["provincia ambigua"] });
  });

  it("canton inexistente dentro de la provincia: 'canton no encontrado en la provincia'", () => {
    expect(erroresDe(resolver({ provincia: "San José", canton: "Escazu", distrito: "Carmen" })))
      .toEqual({ canton: ["canton no encontrado en la provincia"] });
  });

  it("canton duplicado dentro de la provincia: 'canton ambiguo en la provincia'", () => {
    const errores = erroresDe(
      resolver(
        { provincia: "San José", canton: "Central", distrito: "Carmen" },
        {
          cantones: [
            { id: "c-central-sj", nombre: "Central", provinciaId: "p-sj" },
            { id: "c-central-sj-bis", nombre: "central", provinciaId: "p-sj" },
          ],
        },
      ),
    );
    expect(errores).toEqual({ canton: ["canton ambiguo en la provincia"] });
  });

  it("distrito vacio: 'distrito requerido: la zona de la orden se deriva del distrito'", () => {
    expect(erroresDe(resolver({ provincia: "San José", canton: "Central", distrito: "   " })))
      .toEqual({
        distrito: ["distrito requerido: la zona de la orden se deriva del distrito"],
      });
  });

  it("distrito inexistente dentro del canton: 'distrito no encontrado en el canton'", () => {
    expect(erroresDe(resolver({ provincia: "San José", canton: "Central", distrito: "Merced" })))
      .toEqual({ distrito: ["distrito no encontrado en el canton"] });
  });

  it("distrito duplicado dentro del canton: 'distrito ambiguo en el canton'", () => {
    const errores = erroresDe(
      resolver(
        { provincia: "San José", canton: "Central", distrito: "Carmen" },
        {
          distritos: [
            ...DISTRITOS,
            {
              id: "d-carmen-bis",
              nombre: "carmen",
              cantonId: "c-central-sj",
              zonaId: "z-resto",
              esCentral: false,
            },
          ],
        },
      ),
    );
    expect(errores).toEqual({ distrito: ["distrito ambiguo en el canton"] });
  });

  it("distrito sin zona: \"el distrito '<nombre recortado>' no tiene zona asignada\"", () => {
    expect(erroresDe(resolver({ provincia: "San José", canton: "Central", distrito: " Sin Zona " })))
      .toEqual({ distrito: ["el distrito 'Sin Zona' no tiene zona asignada"] });
  });
});

describe("lookup — indice ambiguo-aware", () => {
  it("distingue missing, found y ambiguous por el tamaño del bucket", () => {
    const index = indexBy(
      [
        { id: "a", nombre: "Uno" },
        { id: "b", nombre: "Dos" },
        { id: "c", nombre: "dos" },
      ],
      (r) => normalize(r.nombre),
    );
    expect(lookup(index, "tres")).toEqual({ status: "missing" });
    expect(lookup(index, "uno")).toEqual({ status: "found", row: { id: "a", nombre: "Uno" } });
    expect(lookup(index, "dos")).toEqual({ status: "ambiguous" });
  });
});
