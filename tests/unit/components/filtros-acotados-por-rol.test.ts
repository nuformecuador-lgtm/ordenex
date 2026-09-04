import { describe, it, expect } from "vitest";

import { construirFiltrosEntregas } from "@/app/(app)/_components/entregas-filtros-def";
import { construirFiltrosOrdenes } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// FICHA 355: aquí se importaban `CLAVE_ESTADO`, `ESTADOS_SATELITE`, `construirFiltrosSatelite`,
// `seleccionAFiltroSatelite` y `ESTADOS_BODEGA_SATELITE` y NO se usaba ninguno: los casos de la
// bodega satélite se mudaron y los imports se quedaron atrás. Se retiran —`ESTADOS_SATELITE` ya
// ni existe— y los casos de esa barra viven en `satelite-filtro-estado.test.ts`.

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

// Ficha 351: el mensajero vive DENTRO del catálogo. Antes llegaba en un segundo argumento
// (`MENSAJEROS`) que traía la lista de asignación; ese parámetro ya no existe.
const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  mensajeros: [{ id: "m1", nombre: "Mensajero", zonaId: "z1", estado: "activo" }],
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Central", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "Carmen", padreId: "c1" }],
};

function claves(facetas?: readonly ("zona" | "tienda" | "mensajero")[]): string[] {
  return construirFiltrosEntregas(CATALOGO, { facetas }).map((f) => f.key);
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
    const declaraciones = construirFiltrosEntregas(CATALOGO, {
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
    incluirMensajero?: boolean;
    incluirSalioAReparto?: boolean;
  }): string[] {
    return construirFiltrosOrdenes(CATALOGO, opts).map((f) => f.key);
  }

  it("maestro/admin: la barra entera, con zona y con tienda", () => {
    // FICHA 370: `salio_a_reparto` entra en el censo. La pagina se lo declara con la MISMA
    // condicion que «Reasignables» (`rol !== adminTienda`), asi que aqui va pedido: es de
    // despacho, y quien despacha lo tiene.
    expect(
      clavesOrdenes({ incluirTienda: true, incluirSalioAReparto: true }),
    ).toEqual([
      "q",
      "zona_id",
      "mensajero_id",
      "tienda_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "created",
      "reasignables",
      "salio_a_reparto",
    ]);
  });

  it("adminTienda: la MISMA barra sin el filtro de tienda", () => {
    // Todas sus órdenes son suyas: el selector sería el directorio de sus competidores, y el
    // servicio tampoco le entrega esa lista. «Reasignables» tampoco: es un filtro de despacho
    // de la bodega CENTRAL, y ese estado no está en los que este rol ve. Y el de MENSAJERO
    // cae por lo mismo que el de tienda: es el directorio del personal interno, que a la
    // cuenta tienda ni se le ofrece ni se le entrega.
    //
    // FICHA 370: «Salida a reparto» cae por lo mismo que «Reasignables» —es una pregunta de
    // DESPACHO y este rol no despacha—, y se pide EXPLICITAMENTE en `false` para que el caso
    // siga midiendo la puerta y no el valor por defecto de la opcion.
    const declaradas = clavesOrdenes({
      incluirTienda: false,
      incluirReasignables: false,
      incluirMensajero: false,
      incluirSalioAReparto: false,
    });
    expect(declaradas).not.toContain("tienda_id");
    expect(declaradas).not.toContain("mensajero_id");
    expect(declaradas).not.toContain("salio_a_reparto");
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
