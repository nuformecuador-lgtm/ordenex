import { describe, it, expect } from "vitest";

import {
  construirFiltrosOrdenes,
  GRUPO_CUENTAS_TIENDA,
  GRUPO_INTEGRACIONES,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { CREATED_PRESETS } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Feature 144 / TB3.1 (R51, R55, R56, R62) — declaracion de la barra de ordenes.

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [
    { id: "z1", nombre: "GAM" },
    { id: "z2", nombre: "Satelite Norte" },
  ],
  mensajeros: [
    { id: "m1", nombre: "Ana Mora", zonaId: "z1", estado: "activo" },
    { id: "m2", nombre: "Beto Ruiz", zonaId: "z2", estado: "activo" },
    // Mensajero SIN zona: existe (la columna es nullable) y no se cuela como opcion
    // huerfana en el encadenado.
    { id: "m3", nombre: "Caro Sin Zona", zonaId: null, estado: "activo" },
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

// Los cuatro censos de este archivo enumeran la barra ENTERA para que ampliarla sea una
// decision explicita. La feature 169 la amplia en UNA clave, el buscador `q`, y por
// contrato va PRIMERO (R32): mantener los censos intactos exigiria que la barra mintiera
// sobre lo que declara. Ningun otro caso de este archivo se toco.

describe("construirFiltrosOrdenes — filtros declarados (R55)", () => {
  it("R55: declara el buscador, los filtros de catalogo, el de tiempo y el de reasignables", () => {
    expect(claves(true)).toEqual([
      "q",
      "zona_id",
      "mensajero_id",
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
      "q",
      "zona_id",
      "mensajero_id",
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

  it("R55: los filtros de catalogo son de seleccion multiple", () => {
    for (const clave of [
      "zona_id",
      "mensajero_id",
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
    expect(porClave("mensajero_id").label).toBe("Mensajero");
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

  it("el filtro de MENSAJERO depende de la ZONA, como el canton de la provincia", () => {
    expect(porClave("mensajero_id").dependsOn).toBe("zona_id");
  });

  it("cada mensajero lleva su zona como `parentValue`; el que no tiene zona va sin padre", () => {
    expect(porClave("mensajero_id").options).toEqual([
      { value: "m1", label: "Ana Mora", parentValue: "z1" },
      { value: "m2", label: "Beto Ruiz", parentValue: "z2" },
      // `undefined`, no `null`: el motor de dependencias solo entiende "sin padre".
      { value: "m3", label: "Caro Sin Zona", parentValue: undefined },
    ]);
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

  /**
   * ⚠️ FICHA 351 (2026-09-02) — ESTE CASO AFIRMA LO CONTRARIO DE LO QUE AFIRMABA, Y ES A
   * PROPÓSITO. Decía «R51: las cuentas INACTIVAS se distinguen en el texto visible» y exigía
   * `Tienda Cerrada (inactiva)`, que era la decisión (e) de la feature 144: ofrecerlas, marcadas
   * con un sufijo.
   *
   * EL HUMANO REVIRTIÓ LA DECISIÓN (e) el 2026-09-02 —«muestra tiendas o mensajeros que tenemos
   * desactivos y eso es información que no debe mostrarse»; medido ese día, eran 2 de las 4
   * tiendas del desplegable—. Desde entonces `listCuentasTienda` no entrega cuentas dadas de
   * baja, así que no queda nada que sufijar y `SUFIJO_INACTIVA` se retiró del módulo.
   *
   * El caso NO se borra, se invierte: si alguien vuelve a componer una etiqueta a partir de
   * `activa`, el `toBe` de abajo se pone rojo. Un test que muere sin sustituto es cobertura que
   * se va, y aquí lo que hay que seguir vigilando es LA ETIQUETA.
   */
  it("ficha 351: la etiqueta es el NOMBRE A SECAS — ningún sufijo compuesto desde `activa`", () => {
    const opciones = porClave("tienda_id").options ?? [];
    // `t2` llega con `activa: false` (el fixture lo conserva a propósito: el DTO sigue trayendo
    // la bandera). La declaración ya no la mira.
    expect(opciones.find((o) => o.value === "t2")?.label).toBe("Tienda Cerrada");
    expect(opciones.find((o) => o.value === "t1")?.label).toBe("Tienda Activa");
    // Y ninguna etiqueta, de ninguna cuenta, lleva el paréntesis que se retiró.
    for (const opcion of opciones) {
      expect(opcion.label).not.toMatch(/\(inactiva\)/);
    }
  });

  /**
   * ⚠️ ESTE TAMBIÉN CAMBIÓ DE TÍTULO, Y NO DE CONDUCTA. Se llamaba «R50/R51: las inactivas y las
   * de API key SIGUEN ofreciéndose (no se filtran)», que nombraba la decisión (e) —hoy
   * revertida—; lo que comprueba, en cambio, sigue siendo válido y es importante que lo siga
   * siendo: **esta declaración es PURA y no descarta filas**.
   *
   * El recorte de las cuentas dadas de baja vive en el servidor
   * (`UserRepository.listCuentasTienda`), que es donde un `WHERE` se puede medir contra Postgres
   * (`tests/integration/db/filtros-catalogo-sin-inactivos.test.ts`). Si además se filtrara aquí
   * habría DOS reglas para lo mismo, y la del cliente escondería del desplegable lo que el
   * servidor sí decidió entregar — el modo de fallo que nadie ve.
   */
  it("ficha 351: la declaración NO filtra — pinta lo que el catálogo le entrega, sea lo que sea", () => {
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
      {
        zonas: [],
        tiendas: [],
        mensajeros: [],
        provincias: [],
        cantones: [],
        distritos: [],
      },
      // TODOS quiere decir todos: las dos claves que solo se declaran a peticion
      // —«Eliminadas» y, desde la ficha 370, «Salida a reparto»— se piden aqui, porque si
      // no el censo diria "todos" contando nueve de once.
      { incluirTienda: true, incluirEliminados: true, incluirSalioAReparto: true },
    );
    expect(defs).toHaveLength(11);
    for (const def of defs.filter((d) => d.kind === "multi")) {
      expect(def.options).toEqual([]);
    }
    // «Salida a reparto» es la excepcion que confirma la regla: sus opciones NO salen del
    // catalogo (salen de `SALIO_A_REPARTO_VALORES`), asi que con el catalogo vacio sigue
    // teniendo las tres suyas y el control es utilizable.
    expect(
      defs.find((d) => d.key === "salio_a_reparto")?.options,
    ).toHaveLength(3);
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
      "q",
      "zona_id",
      "mensajero_id",
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

describe("construirFiltrosOrdenes — filtro por MENSAJERO", () => {
  it("cae SOLO esa clave cuando el rol no lo recibe (`incluirMensajero: false`)", () => {
    const claves = construirFiltrosOrdenes(CATALOGO, {
      incluirTienda: true,
      incluirMensajero: false,
    }).map((f) => f.key);
    expect(claves).not.toContain("mensajero_id");
    expect(claves).toEqual([
      "q",
      "zona_id",
      "tienda_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
      "reasignables",
    ]);
  });

  it("la opcion emite el ID y muestra el NOMBRE (nunca datos del mensajero)", () => {
    for (const opcion of porClave("mensajero_id").options ?? []) {
      expect(Object.keys(opcion).sort()).toEqual(["label", "parentValue", "value"]);
    }
  });
});
