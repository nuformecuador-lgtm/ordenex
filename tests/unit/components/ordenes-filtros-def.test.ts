import { describe, it, expect } from "vitest";

import {
  construirFiltrosOrdenes,
  GRUPO_CUENTAS_TIENDA,
  GRUPO_INTEGRACIONES,
  SUFIJO_INACTIVA,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { CREATED_PRESETS } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Feature 144 / TB3.1 (R51, R55, R56, R62) — declaracion de la barra de ordenes.

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [
    { id: "z1", nombre: "GAM" },
    { id: "z2", nombre: "Satelite Norte" },
  ],
  tiendas: [
    { id: "t1", nombre: "Tienda Activa", esApiKey: false, activa: true },
    { id: "t2", nombre: "Tienda Cerrada", esApiKey: false, activa: false },
    { id: "t3", nombre: "Integracion Shopify", esApiKey: true, activa: true },
  ],
  provincias: [
    { id: "p1", nombre: "San José" },
    { id: "p2", nombre: "Alajuela" },
  ],
  cantones: [
    { id: "c1", nombre: "Central", padreId: "p1" },
    { id: "c2", nombre: "Escazú", padreId: "p1" },
    { id: "c3", nombre: "Alajuela Central", padreId: "p2" },
  ],
  distritos: [
    { id: "d1", nombre: "Carmen", padreId: "c1" },
    { id: "d2", nombre: "San Rafael", padreId: "c2" },
  ],
};

function claves(incluirTienda: boolean): string[] {
  return construirFiltrosOrdenes(CATALOGO, { incluirTienda }).map((f) => f.key);
}

function porClave(clave: string, incluirTienda = true) {
  const def = construirFiltrosOrdenes(CATALOGO, { incluirTienda }).find(
    (f) => f.key === clave,
  );
  if (!def) throw new Error(`no se declaro el filtro ${clave}`);
  return def;
}

describe("construirFiltrosOrdenes — filtros declarados (R55)", () => {
  it("R55: declara los filtros de catalogo, el de tiempo y el de reasignables", () => {
    expect(claves(true)).toEqual([
      "zona_id",
      "tienda_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
      "reasignables",
    ]);
  });

  it("R62: sin el filtro de tienda cae SOLO esa clave (rol acotado a su propia tienda)", () => {
    expect(claves(false)).toEqual([
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
      "reasignables",
    ]);
    expect(claves(false)).not.toContain("tienda_id");
  });

  it("R55: el filtro de TIEMPO es UNO solo, de tipo rango con atajos por dentro", () => {
    const creado = porClave("created");
    expect(creado.kind).toBe("dateRange");
    expect(creado.options?.map((o) => o.value)).toEqual([...CREATED_PRESETS]);
    // No hay un segundo filtro temporal (preset y rango no se parten en dos claves).
    expect(claves(true).filter((k) => k.startsWith("created"))).toEqual(["created"]);
  });

  it("R55: los cinco filtros de catalogo son de seleccion multiple", () => {
    for (const clave of [
      "zona_id",
      "tienda_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
    ]) {
      expect(porClave(clave).kind).toBe("multi");
    }
  });

  it("R55: cada filtro lleva su etiqueta visible", () => {
    expect(porClave("zona_id").label).toBe("Zona");
    expect(porClave("tienda_id").label).toBe("Tienda");
    expect(porClave("provincia_id").label).toBe("Provincia");
    expect(porClave("canton_id").label).toBe("Cantón");
    expect(porClave("distrito_id").label).toBe("Distrito");
    expect(porClave("created").label).toBe("Fecha de creación");
  });

  it("las opciones de catalogo emiten el ID y muestran el NOMBRE, en el orden recibido", () => {
    expect(porClave("zona_id").options).toEqual([
      { value: "z1", label: "GAM" },
      { value: "z2", label: "Satelite Norte" },
    ]);
  });
});

describe("construirFiltrosOrdenes — cadena geografica declarada (R56)", () => {
  it("R56: canton depende de provincia y distrito depende de canton", () => {
    expect(porClave("canton_id").dependsOn).toBe("provincia_id");
    expect(porClave("distrito_id").dependsOn).toBe("canton_id");
  });

  it("R56: zona, tienda y provincia NO dependen de nadie", () => {
    expect(porClave("zona_id").dependsOn).toBeUndefined();
    expect(porClave("tienda_id").dependsOn).toBeUndefined();
    expect(porClave("provincia_id").dependsOn).toBeUndefined();
  });

  it("R56: cada canton lleva su provincia como `parentValue`", () => {
    expect(porClave("canton_id").options).toEqual([
      { value: "c1", label: "Central", parentValue: "p1" },
      { value: "c2", label: "Escazú", parentValue: "p1" },
      { value: "c3", label: "Alajuela Central", parentValue: "p2" },
    ]);
  });

  it("R56: cada distrito lleva su canton como `parentValue`", () => {
    expect(porClave("distrito_id").options).toEqual([
      { value: "d1", label: "Carmen", parentValue: "c1" },
      { value: "d2", label: "San Rafael", parentValue: "c2" },
    ]);
  });

  it("el filtro de tiempo NO participa en la cadena de dependencias", () => {
    expect(porClave("created").dependsOn).toBeUndefined();
  });
});

describe("construirFiltrosOrdenes — cuentas tienda (R51)", () => {
  it("R51: las cuentas por API key caen en un GRUPO distinto del de las cuentas por sesion", () => {
    const opciones = porClave("tienda_id").options ?? [];
    expect(opciones.find((o) => o.value === "t3")?.group).toBe(GRUPO_INTEGRACIONES);
    expect(opciones.find((o) => o.value === "t1")?.group).toBe(GRUPO_CUENTAS_TIENDA);
  });

  it("R51: las cuentas INACTIVAS se distinguen en el texto visible", () => {
    const opciones = porClave("tienda_id").options ?? [];
    expect(opciones.find((o) => o.value === "t2")?.label).toBe(
      `Tienda Cerrada${SUFIJO_INACTIVA}`,
    );
    expect(opciones.find((o) => o.value === "t1")?.label).toBe("Tienda Activa");
  });

  it("R50/R51: las inactivas y las de API key SIGUEN ofreciendose (no se filtran)", () => {
    const valores = (porClave("tienda_id").options ?? []).map((o) => o.value);
    expect(valores).toEqual(["t1", "t2", "t3"]);
  });

  it("R54: la opcion de tienda solo expone id y nombre visible (ninguna bandera cruda)", () => {
    for (const opcion of porClave("tienda_id").options ?? []) {
      expect(Object.keys(opcion).sort()).toEqual(["group", "label", "value"]);
    }
  });
});

describe("construirFiltrosOrdenes — catalogo vacio (R64)", () => {
  it("con catalogo vacio sigue declarando TODOS los filtros, sin opciones", () => {
    const defs = construirFiltrosOrdenes(
      { zonas: [], tiendas: [], provincias: [], cantones: [], distritos: [] },
      { incluirTienda: true },
    );
    expect(defs).toHaveLength(7);
    for (const def of defs.filter((d) => d.kind === "multi")) {
      expect(def.options).toEqual([]);
    }
  });
});

describe("construirFiltrosOrdenes — filtro REASIGNABLES", () => {
  it("es un interruptor: `boolean` y sin opciones que elegir", () => {
    const def = porClave("reasignables");
    expect(def.kind).toBe("boolean");
    expect(def.label).toBe("Reasignables");
    expect(def.options).toBeUndefined();
  });

  it("no depende de ningun otro filtro (no se poda ni se acota)", () => {
    expect(porClave("reasignables").dependsOn).toBeUndefined();
  });

  it("`incluirReasignables: false` (adminTienda) cae SOLO esa clave", () => {
    const claves = construirFiltrosOrdenes(CATALOGO, {
      incluirTienda: false,
      incluirReasignables: false,
    }).map((f) => f.key);
    expect(claves).toEqual([
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
    ]);
  });

  it("se declara por omision (no hay que pedirlo para maestro/admin)", () => {
    const claves = construirFiltrosOrdenes(CATALOGO, { incluirTienda: true }).map(
      (f) => f.key,
    );
    expect(claves).toContain("reasignables");
  });
});

