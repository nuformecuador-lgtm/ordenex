import { describe, it, expect } from "vitest";

import {
  construirFiltrosOrdenes,
  CLAVE_BUSQUEDA,
  PLACEHOLDER_BUSQUEDA,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";
import { BUSQUEDA_MIN_CHARS, ordenFilterSchema } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Feature 169 / T3.2 + T3.3 (R32, R36) — declaracion del buscador en la barra de
// ordenes y su traduccion al `filter` de `listarOrdenes`.

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Central", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "Carmen", padreId: "c1" }],
};

function declarados(opts: {
  incluirTienda?: boolean;
  incluirReasignables?: boolean;
} = {}) {
  return construirFiltrosOrdenes(CATALOGO, {
    incluirTienda: opts.incluirTienda ?? true,
    incluirReasignables: opts.incluirReasignables,
  });
}

function aceptadoPorElBorde(filter: unknown) {
  return ordenFilterSchema.safeParse(filter).success;
}

describe("construirFiltrosOrdenes — el buscador va PRIMERO (R32)", () => {
  it("R32: el PRIMER filtro declarado es el de busqueda", () => {
    expect(declarados()[0]?.key).toBe(CLAVE_BUSQUEDA);
  });

  it("R32: sigue siendo el primero aunque caigan los filtros que dependen del rol", () => {
    expect(
      declarados({ incluirTienda: false, incluirReasignables: false })[0]?.key,
    ).toBe(CLAVE_BUSQUEDA);
  });

  it("R32: es UNO solo (no hay dos campos de texto en la barra)", () => {
    expect(declarados().filter((f) => f.kind === "text")).toHaveLength(1);
  });

  it("R33: se declara sobre el tipo generico `text`, con su etiqueta visible", () => {
    const busqueda = declarados()[0];
    expect(busqueda?.kind).toBe("text");
    expect(busqueda?.label).toBe("Buscar");
  });

  it("el minimo declarado es EL MISMO que valida el borde (una sola fuente)", () => {
    expect(declarados()[0]?.minChars).toBe(BUSQUEDA_MIN_CHARS);
  });

  it("el placeholder nombra los CUATRO datos buscables (es la unica pista que hay)", () => {
    expect(declarados()[0]?.placeholder).toBe(PLACEHOLDER_BUSQUEDA);
    for (const dato of ["Guía", "remisión", "teléfono", "destinatario"]) {
      expect(PLACEHOLDER_BUSQUEDA).toContain(dato);
    }
  });

  it("no depende de ningun otro filtro: no se poda ni se acota con la geografia", () => {
    expect(declarados()[0]?.dependsOn).toBeUndefined();
    expect(declarados()[0]?.options).toBeUndefined();
  });

  it("R32: se declara aunque el catalogo geografico venga vacio (no sale de el)", () => {
    const sinCatalogo = construirFiltrosOrdenes(
      { zonas: [], tiendas: [], provincias: [], cantones: [], distritos: [] },
      { incluirTienda: true },
    );
    expect(sinCatalogo[0]?.key).toBe(CLAVE_BUSQUEDA);
  });
});

describe("seleccionAFilter — el termino viaja como ESCALAR (R36)", () => {
  it("R36: `[\"juan perez\"]` -> `q: \"juan perez\"`, no una lista", () => {
    const filter = seleccionAFilter({ q: ["juan perez"] });
    expect(filter).toEqual({ q: "juan perez" });
    expect(Array.isArray((filter as { q?: unknown }).q)).toBe(false);
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("R36: sin termino, la clave NO aparece en el filter", () => {
    expect(seleccionAFilter({})).not.toHaveProperty("q");
    expect(seleccionAFilter({ zona_id: ["z1"] })).toEqual({ zona_id: ["z1"] });
  });

  it("R36: una lista vacia se omite (el control ya retira la clave al vaciar el campo)", () => {
    const filter = seleccionAFilter({ q: [], zona_id: ["z1"] });
    expect(filter).not.toHaveProperty("q");
    expect(filter).toEqual({ zona_id: ["z1"] });
  });

  it("mandarlo como LISTA seria `validation_error`: por eso se baja a escalar", () => {
    expect(aceptadoPorElBorde({ q: ["juan"] })).toBe(false);
    expect(aceptadoPorElBorde({ q: "juan" })).toBe(true);
  });

  it("R14: convive con el resto de claves en el MISMO objeto, sin pisarlas", () => {
    const filter = seleccionAFilter({
      q: ["juan"],
      zona_id: ["z1"],
      status_id: ["est-1"],
      reasignables: ["true"],
      created: ["", "2026-07-01", "2026-07-28"],
    });
    expect(filter).toEqual({
      q: "juan",
      zona_id: ["z1"],
      status_id: ["est-1"],
      reasignables: true,
      created_desde: "2026-07-01",
      created_hasta: "2026-07-28",
    });
    expect(aceptadoPorElBorde(filter)).toBe(true);
  });

  it("no toca el termino: lo que emitio el control es lo que se envia", () => {
    const filter = seleccionAFilter({ q: ["Peña 100%"] }) as { q?: string };
    expect(filter.q).toBe("Peña 100%");
  });

  it("R3: un termino por debajo del minimo NO deberia llegar, y si llega lo para el borde", () => {
    // El control omite la clave por debajo del minimo (R35). Esta es la segunda linea:
    // si alguien construyera la seleccion a mano, el borde responde `validation_error`.
    const filter = seleccionAFilter({ q: ["ab"] });
    expect(filter).toEqual({ q: "ab" });
    expect(aceptadoPorElBorde(filter)).toBe(false);
  });
});
