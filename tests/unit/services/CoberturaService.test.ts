import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import type {
  CantonCoberturaRow,
  DistritoCoberturaRow,
  ICoberturaDistritoRepository,
  ProvinciaCoberturaRow,
} from "@/lib/interfaces/repositories/ICoberturaDistritoRepository";
import { CoberturaService } from "@/lib/services/CoberturaService";
import { aCoberturaPublica, type ArbolGeograficoPublico } from "@/lib/types/cotizador";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 248 — T3.2. Cubre R2, R3, R4 (los tres estados de la zona del distrito) y R7 (la
// proyeccion publica no expone `esCentral` ni ids).
//
// Todo va con un doble del repositorio: el service no toca Prisma en ningun test, que es lo
// que permite afirmar que la cobertura se decide con el util compartido y con nada mas.

const PROVINCIAS: ProvinciaCoberturaRow[] = [
  { id: "prov-sj", nombre: "San José" },
  { id: "prov-lim", nombre: "Limón" },
];

const CANTONES: CantonCoberturaRow[] = [
  { id: "can-central", nombre: "Central", provinciaId: "prov-sj" },
  { id: "can-limon", nombre: "Central", provinciaId: "prov-lim" },
];

/** Los tres casos que la feature tiene que distinguir, en el mismo canton. */
const DISTRITOS: DistritoCoberturaRow[] = [
  {
    id: "dist-carmen",
    nombre: "Carmen",
    cantonId: "can-central",
    zonas: [{ zonaId: "zona-gam", nombre: "GAM", esCentral: true }],
  },
  { id: "dist-hospital", nombre: "Hospital", cantonId: "can-central", zonas: [] },
  {
    id: "dist-merced",
    nombre: "Merced",
    cantonId: "can-central",
    zonas: [
      { zonaId: "zona-gam", nombre: "GAM", esCentral: true },
      { zonaId: "zona-periferia", nombre: "Periferia", esCentral: false },
    ],
  },
];

function buildRepo(): { repo: ICoberturaDistritoRepository; arbol: ReturnType<typeof vi.fn> } {
  const arbol = vi.fn(async (): Promise<ArbolGeograficoPublico> => []);
  const repo: ICoberturaDistritoRepository = {
    listarProvincias: async () => PROVINCIAS,
    listarCantonesPorProvincias: async (ids) =>
      CANTONES.filter((c) => ids.includes(c.provinciaId)),
    listarDistritosPorCantones: async (ids) => DISTRITOS.filter((d) => ids.includes(d.cantonId)),
    listarArbolGeograficoPublico: arbol,
  };
  return { repo, arbol };
}

function service(): CoberturaService {
  return new CoberturaService(buildRepo().repo);
}

describe("CoberturaService — los tres estados de la zona del distrito", () => {
  it("R2 — distrito con UNA zona responde cubierto con el nombre de la zona", async () => {
    const resultado = await service().consultar({
      provincia: "San José",
      canton: "Central",
      distrito: "Carmen",
    });

    expect(resultado).toEqual({
      estado: "cubierto",
      distritoId: "dist-carmen",
      zonaId: "zona-gam",
      zonaNombre: "GAM",
      esCentral: true,
    });
    // El NOMBRE es lo que el requisito pide indicar, y es lo que llega al DTO publico.
    expect(aCoberturaPublica(resultado)).toEqual({ estado: "cubierto", zonaNombre: "GAM" });
  });

  it("R2 — resuelve el trio con el mismo normalizador que la carga (acentos, mayusculas, espacios)", async () => {
    const resultado = await service().consultar({
      provincia: "san jose",
      canton: "CENTRAL",
      distrito: "  carmen ",
    });

    expect(resultado).toMatchObject({ estado: "cubierto", zonaNombre: "GAM" });
  });

  it("R3 — distrito sin filas en zona_distrito responde sin cobertura y sin zona", async () => {
    const resultado = await service().consultar({
      provincia: "San José",
      canton: "Central",
      distrito: "Hospital",
    });

    expect(resultado).toEqual({ estado: "sin_cobertura" });
    // No hay ninguna zona nombrada: el objeto entero tiene UNA clave.
    expect(Object.keys(resultado)).toEqual(["estado"]);
    expect(JSON.stringify(aCoberturaPublica(resultado))).not.toContain("zona");
  });

  it("R4 — distrito con DOS zonas responde no determinado y no nombra ninguna", async () => {
    const resultado = await service().consultar({
      provincia: "San José",
      canton: "Central",
      distrito: "Merced",
    });

    expect(resultado).toEqual({ estado: "no_determinado", cuantas: 2 });
    // Ni "GAM" ni "Periferia": no se elige la primera, ni la mas antigua, ni se devuelven las dos.
    const publico = JSON.stringify(aCoberturaPublica(resultado));
    expect(publico).not.toContain("GAM");
    expect(publico).not.toContain("Periferia");
    expect(publico).not.toContain("zonaNombre");
  });

  it("R5 — el trio que no resuelve un distrito unico devuelve error por campo", async () => {
    const porProvincia = await service().consultar({
      provincia: "Atlantida",
      canton: "Central",
      distrito: "Carmen",
    });
    const porCanton = await service().consultar({
      provincia: "San José",
      canton: "Escazú",
      distrito: "Carmen",
    });
    const porDistrito = await service().consultar({
      provincia: "San José",
      canton: "Central",
      distrito: "Zapote",
    });

    expect(porProvincia).toEqual({
      estado: "validation_error",
      campos: { provincia: "provincia no encontrada" },
    });
    expect(porCanton).toEqual({
      estado: "validation_error",
      campos: { canton: "canton no encontrado en la provincia" },
    });
    expect(porDistrito).toEqual({
      estado: "validation_error",
      campos: { distrito: "distrito no encontrado en el canton" },
    });
  });

  it("R2/R4 — el canton se busca DENTRO de la provincia elegida, no en todo el pais", async () => {
    // "Central" existe en las dos provincias; el homonimo de Limón no tiene distritos cargados,
    // asi que resolverlo mal daria "distrito no encontrado" en vez de "cubierto".
    const resultado = await service().consultar({
      provincia: "Limón",
      canton: "Central",
      distrito: "Carmen",
    });

    expect(resultado).toEqual({
      estado: "validation_error",
      campos: { distrito: "distrito no encontrado en el canton" },
    });
  });
});

describe("R7 — la salida publica no expone esCentral ni ids de zona/tarifa/tienda", () => {
  it("el DTO publico del caso cubierto tiene EXACTAMENTE dos claves: estado y zonaNombre", async () => {
    const dominio = await service().consultar({
      provincia: "San José",
      canton: "Central",
      distrito: "Carmen",
    });

    // El resultado de DOMINIO si lleva `esCentral` y los ids: `CotizadorService` los necesita
    // para elegir la columna del flete. Ese es el punto de la separacion.
    expect(dominio).toMatchObject({ esCentral: true, zonaId: "zona-gam", distritoId: "dist-carmen" });

    const publico = aCoberturaPublica(dominio);
    expect(Object.keys(publico).sort()).toEqual(["estado", "zonaNombre"]);

    const serializado = JSON.stringify(publico);
    for (const prohibido of [
      "esCentral",
      "es_central",
      "zonaId",
      "zona-gam",
      "distritoId",
      "dist-carmen",
      "tarifa",
      "tienda",
    ]) {
      expect(serializado, `el DTO publico filtra ${prohibido}`).not.toContain(prohibido);
    }
  });

  it("ninguno de los cuatro estados publicos declara un importe", async () => {
    const estados = await Promise.all([
      service().consultar({ provincia: "San José", canton: "Central", distrito: "Carmen" }),
      service().consultar({ provincia: "San José", canton: "Central", distrito: "Hospital" }),
      service().consultar({ provincia: "San José", canton: "Central", distrito: "Merced" }),
      service().consultar({ provincia: "Nada", canton: "Nada", distrito: "Nada" }),
    ]);

    for (const dominio of estados) {
      const serializado = JSON.stringify(aCoberturaPublica(dominio));
      for (const prohibido of ["monto", "flete", "iva", "comision", "total", "precio", "costo"]) {
        expect(serializado.toLowerCase()).not.toContain(prohibido);
      }
    }
  });

  it("R10 — el modulo no importa ingreso-ordenex ni el resolver de tarifas", () => {
    // Complemento del test de comportamiento: la propiedad se mide sobre la fuente, porque un
    // import que solo se usara en una rama no aparecería en ninguna asercion de resultado.
    //
    // Se lee SIN COMENTARIOS a proposito: los de estos modulos NOMBRAN lo que tienen prohibido
    // («no toca `prisma.tarifa`»), y un barrido sobre el texto crudo denunciaria la explicacion
    // en vez del codigo (lección de la feature 209, `tests/fixtures/sin-comentarios.ts`).
    for (const modulo of [
      "lib/services/CoberturaService.ts",
      "lib/repositories/CoberturaDistritoRepository.ts",
      "lib/types/cotizador.ts",
    ]) {
      const fuente = quitarComentarios(
        readFileSync(path.resolve(process.cwd(), modulo), "utf8"),
      );
      const imports = [...fuente.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);
      expect(imports, `${modulo} importa dinero`).not.toContain("@/lib/utils/ingreso-ordenex");
      for (const especificador of imports) {
        expect(especificador, `${modulo} importa ${especificador}`).not.toMatch(
          /TarifaVigentePorTienda/,
        );
      }
      expect(fuente).not.toContain("prisma.tarifa");
    }
  });
});
