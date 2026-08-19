import { describe, it, expect } from "vitest";

import { construirFiltrosEntregas } from "@/app/(app)/_components/entregas-filtros-def";
import {
  CLAVE_ESTADO,
  ESTADOS_SATELITE,
  construirFiltrosSatelite,
  seleccionAFiltroSatelite,
} from "@/app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros";
import { construirFiltrosOrdenes } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Pedido humano (2026-08-19): la barra de filtros de órdenes NO puede ofrecerle a cada rol
// una coordenada que su alcance ya tiene fijada.
//
//   - el `adminTienda` no elige TIENDA: todas sus órdenes son suyas, y el selector sería el
//     directorio de sus competidores;
//   - el `adminSatelite` no elige ZONA: la suya está fijada, y hasta hoy veía el control con
//     la lista vacía —un filtro que parece averiado—;
//   - y su geografía se limita a la de SU zona, que es lo que el catálogo del servidor le
//     entrega (ver `filtros-ordenes-service.test.ts`).
//
// La barra de la bodega satélite (`/recepcion-satelite`) declara sus filtros aparte y tiene
// sus propios tests; aquí sólo vive la de entregas.
//
// Quién decide qué facetas se ofrecen NO es la barra: es `recorteDePresentacion` (feature
// 133), que razona sobre el ALCANCE. Aquí se afirma la traducción de su respuesta a
// controles declarados, que es lo único que estos módulos deciden.

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Central", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "Carmen", padreId: "c1" }],
};

const MENSAJEROS = [{ id: "m1", nombre: "Mensajero" }];

function claves(facetas?: readonly ("zona" | "tienda" | "mensajero")[]): string[] {
  return construirFiltrosEntregas(CATALOGO, MENSAJEROS, { facetas }).map((f) => f.key);
}

describe("barra de entregas — facetas acotadas por el alcance", () => {
  it("sin recorte (alcance global) declara las siete", () => {
    expect(claves()).toEqual([
      "created",
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "tienda_id",
      "mensajero_id",
    ]);
  });

  it("adminTienda (facetas = [zona]): NO se declara el filtro de tienda", () => {
    const declaradas = claves(["zona"]);
    expect(declaradas).not.toContain("tienda_id");
    expect(declaradas).not.toContain("mensajero_id");
    // Lo que sí conserva: zona, la cadena geográfica entera y la fecha.
    expect(declaradas).toEqual([
      "created",
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
    ]);
  });

  it("adminSatelite (facetas = []): ni zona, ni tienda, ni mensajero", () => {
    const declaradas = claves([]);
    expect(declaradas).not.toContain("zona_id");
    expect(declaradas).not.toContain("tienda_id");
    expect(declaradas).not.toContain("mensajero_id");
    // La geografía NO es una faceta del recorte: se ofrece siempre, y lo que la acota es el
    // catálogo (el servidor le entrega la de su zona).
    expect(declaradas).toEqual(["created", "provincia_id", "canton_id", "distrito_id"]);
  });

  it("un filtro que no se declara tampoco se ofrece en el selector", () => {
    // El selector de «Filtros» se construye SOBRE las declaraciones (`filtros.map`), así que
    // esta es la misma lista. Se afirma para que nadie lo reintroduzca por otra vía.
    const declaraciones = construirFiltrosEntregas(CATALOGO, MENSAJEROS, {
      facetas: ["zona"],
    });
    expect(declaraciones.some((f) => f.label === "Tienda")).toBe(false);
  });
});

describe("barra de órdenes — el rol acotado no elige la coordenada que ya tiene fijada", () => {
  /** Las claves que declara la barra de `/ordenes`, tal como se le monta a cada rol. */
  function clavesOrdenes(opts: {
    incluirTienda: boolean;
    incluirZona?: boolean;
    incluirReasignables?: boolean;
  }): string[] {
    return construirFiltrosOrdenes(CATALOGO, opts).map((f) => f.key);
  }

  it("maestro/admin: la barra entera, con zona y con tienda", () => {
    expect(clavesOrdenes({ incluirTienda: true })).toEqual([
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

  it("adminTienda: la MISMA barra sin el filtro de tienda", () => {
    // Todas sus órdenes son suyas: el selector sería el directorio de sus competidores, y el
    // servicio tampoco le entrega esa lista. «Reasignables» tampoco: es un filtro de despacho
    // de la bodega CENTRAL, y ese estado no está en los que este rol ve.
    const declaradas = clavesOrdenes({ incluirTienda: false, incluirReasignables: false });
    expect(declaradas).not.toContain("tienda_id");
    expect(declaradas).toEqual([
      "q",
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
    ]);
  });
});
