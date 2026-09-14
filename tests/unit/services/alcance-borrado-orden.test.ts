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
//   - QUIEN esta en cada cubeta, que es la decision que este archivo custodia;
//   - que la union discriminada no deja pasar un «propias» sin dueño.
//
// ⭑ FICHA 424 (2026-09-14) — EL `admin` VUELVE A «todas», y este archivo lo dice con su historia.
// Hasta hoy la tercera linea de arriba decia «que el `admin` sigue fuera, decision del
// 2026-08-27 que esta ficha NO revierte». El humano (Carlos Restrepo) SI la revierte el
// 2026-09-14, con su consecuencia sobre la mesa: pasan de 2 a 6 las personas capaces de retirar
// una orden del sistema. Lo que la sostiene es el rastro de la ficha 362 —nombre y rol
// CONGELADOS por orden borrada, agrupados por acto—, medido con el rol nuevo contra Postgres en
// `tests/integration/db/orden-eliminada-actor-admin.test.ts` (que la fila queda) y en
// `historial-accion-lectura.test.ts` (que el `maestro` la encuentra). El motivo del
// estrechamiento original NO se borra de este archivo: se conserva abajo, en su caso.

const actorCon = (rol: RolValue, usuarioId = "u-1"): Actor => ({ usuarioId, rol });

describe("resolverAlcanceBorradoOrden", () => {
  it.each([
    ["maestro", RolValue.maestro],
    ["admin (ficha 424, 2026-09-14)", RolValue.admin],
  ])("%s -> todas (sin frontera de tienda)", (_nombre, rol) => {
    // Los DOS roles del equipo que retiran una orden del sistema entero. El `admin` estuvo aqui
    // hasta el 2026-08-27, salio por el pedido de aquel dia —«con dos roles capaces de borrar, el
    // rastro de quien lo hizo deja de ser una sola persona»— y vuelve el 2026-09-14 por pedido
    // expreso del humano, apoyado en que hoy ese rastro existe y dice QUIEN, con QUE ROL, sobre
    // QUE ORDEN y en QUE ACTO (ficha 362).
    expect(resolverAlcanceBorradoOrden(actorCon(rol))).toEqual({
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
    ["adminSatelite", RolValue.adminSatelite],
    ["mensajero", RolValue.mensajero],
  ])("%s -> denegado", (_nombre, rol) => {
    // Los testigos VIVOS del lado cerrado. Importan mas desde la 424, no menos: al mover el
    // `admin` de cubeta, son ellos los que impiden que la reversion se haya llevado por delante
    // la direccion de la lista. `adminSatelite` opera en `/recepcion-satelite` y el `mensajero`
    // en `/mis-asignaciones`; ninguno de los dos retira una orden del sistema.
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

    // ⚠️ ESTE `toEqual` ES EL CONTRATO, no un polizon: es la clasificacion COMPLETA del catalogo
    // de roles y la unica aserto del repo que dice, de una vez, quien puede borrar una orden y
    // con que alcance. La ficha 424 lo ACTUALIZA (el `admin` pasa de `denegado` a `todas`); lo
    // que no se hace nunca es RELAJARLO a algo mas permisivo —un `toMatchObject`, un
    // `arrayContaining` o comprobar solo la cubeta que interesa—, porque entonces dejaria de
    // delatar al siguiente rol que alguien mueva sin decirlo.
    expect(porAlcance).toEqual({
      todas: [RolValue.maestro, RolValue.admin],
      propias: [RolValue.adminTienda, RolValue.apiKey],
      denegado: [RolValue.mensajero, RolValue.adminSatelite],
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
