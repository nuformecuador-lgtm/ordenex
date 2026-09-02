import { describe, it, expect } from "vitest";
import { RolValue } from "@prisma/client";

import { resolverAlcanceBorradoOrden } from "@/lib/services/alcance-borrado-orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 358 — LA REGLA DE DUEÑO DEL BORRADO, medida en su fuente unica.
//
// Este archivo es corto a proposito: la funcion no tiene ramas escondidas y lo que hay que
// blindar no es su complejidad, es su UNICIDAD y su direccion de fallo. Lo que impide de verdad
// que una tienda borre lo ajeno es el `where` del repositorio, y eso se mide contra Postgres en
// `tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts`.
//
// Lo que SI se mide aqui, y no se puede medir alli:
//   - que la lista de roles es de INCLUSION (un `RolValue` nuevo nace sin poder borrar);
//   - que el `admin` sigue fuera, que es una decision del 2026-08-27 que esta ficha NO revierte;
//   - que la union discriminada no deja pasar un «propias» sin dueño.

const actorCon = (rol: RolValue, usuarioId = "u-1"): Actor => ({ usuarioId, rol });

describe("resolverAlcanceBorradoOrden", () => {
  it("maestro -> todas (sin frontera de tienda)", () => {
    expect(resolverAlcanceBorradoOrden(actorCon(RolValue.maestro))).toEqual({
      alcance: "todas",
    });
  });

  it.each([
    ["adminTienda (pantalla, ficha 358)", RolValue.adminTienda],
    ["apiKey (canal de integracion, ficha 320)", RolValue.apiKey],
  ])("%s -> propias, con el dueño en `actor.usuarioId`", (_nombre, rol) => {
    // Que las DOS formas que tiene una tienda de dirigirse al sistema salgan de la misma linea
    // es el punto entero de este modulo: si una se ampliara sin la otra, la pantalla y la API
    // dejarian de coincidir sobre la misma orden.
    expect(resolverAlcanceBorradoOrden(actorCon(rol, "tienda-7"))).toEqual({
      alcance: "propias",
      ownerId: "tienda-7",
    });
  });

  it.each([
    ["admin", RolValue.admin],
    ["adminSatelite", RolValue.adminSatelite],
    ["mensajero", RolValue.mensajero],
  ])("%s -> denegado", (_nombre, rol) => {
    // El `admin` es el caso con historia: la feature «eliminar orden» nacio con maestro/admin y
    // el humano lo ESTRECHO el 2026-08-27 («con dos roles capaces de borrar, el rastro deja de
    // ser una sola persona»). La 358 abre el borrado a la tienda y NO reabre eso. Este caso es
    // el que impide que alguien «restaure la paridad» sin leer por que se rompio.
    expect(resolverAlcanceBorradoOrden(actorCon(rol))).toEqual({ alcance: "denegado" });
  });

  it("la lista es de INCLUSION: el catalogo entero de roles esta clasificado, y sin sorpresas", () => {
    // Autocomprobacion: recorre el enum REAL de Prisma, no una lista escrita a mano aqui. Si
    // mañana nace un `RolValue`, este caso lo obliga a aparecer en una de las dos cubetas —y por
    // defecto cae en «denegado», que es la direccion segura—.
    const roles = Object.values(RolValue);
    expect(roles.length).toBeGreaterThanOrEqual(6);

    const porAlcance = { todas: [] as string[], propias: [] as string[], denegado: [] as string[] };
    for (const rol of roles) {
      porAlcance[resolverAlcanceBorradoOrden(actorCon(rol)).alcance].push(rol);
    }

    expect(porAlcance).toEqual({
      todas: [RolValue.maestro],
      propias: [RolValue.adminTienda, RolValue.apiKey],
      denegado: [RolValue.admin, RolValue.mensajero, RolValue.adminSatelite],
    });
  });

  it("«propias» NUNCA viaja sin `ownerId`", () => {
    // La union discriminada existe para que un `ownerId` no se pueda olvidar. Se afirma tambien
    // en tiempo de ejecucion: un `usuarioId` vacio o ausente convertiria el `where` del
    // repositorio en un filtro que no filtra.
    const r = resolverAlcanceBorradoOrden(actorCon(RolValue.adminTienda, "t-9"));
    expect(r.alcance).toBe("propias");
    if (r.alcance !== "propias") throw new Error("inalcanzable: ya se afirmo arriba");
    expect(r.ownerId).toBe("t-9");
    expect(r.ownerId.length).toBeGreaterThan(0);
  });
});
