import { describe, it, expect } from "vitest";

import { esAccesoTotal, ROLES_ACCESO_TOTAL } from "@/lib/auth/acceso-total";
import { ALCANCE_PRODUCTOS } from "@/lib/analytics/metrics";
import { resolverAlcanceProductos } from "@/lib/analytics/productos-consulta";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

// Ficha 345 / T2.5 — QUIEN VE QUE (R1, R2, R3, R4, R6).
//
// Es la frontera multi-tenant de esta ficha. Sin policies RLS debajo (Prisma se conecta con
// credenciales de servicio), `resolverAlcanceProductos` es la UNICA separacion entre inquilinos:
// un fallo aqui no da una cifra equivocada, filtra los productos de una tienda a otra.
//
// Lo que este archivo NO puede probar, y por eso existe `tests/integration/repositories/
// conteo-productos.int.test.ts`: que ese alcance viaje de verdad al `WHERE`. Aqui se prueba lo
// que se DECIDE; alli, lo que la base HACE.

const ACTOR = (rol: string, extra: Record<string, unknown> = {}): ActorAnalitica =>
  ({ usuarioId: "u-propio", rol, ...extra }) as unknown as ActorAnalitica;

describe("R1 · la tabla cubre los cinco roles lectores, exhaustiva", () => {
  it("`ALCANCE_PRODUCTOS` tiene una entrada por cada rol de `ROLES_ANALITICA`, y ninguna mas", () => {
    // Omitir un rol NO COMPILA (el `satisfies Record<RolAnalitica, AlcanceMetrica>` de
    // `metrics.ts`), y esto lo dice tambien en tiempo de ejecucion por si alguien relajara el
    // tipo: la lista de claves es exactamente la de los cinco roles.
    expect([...Object.keys(ALCANCE_PRODUCTOS)].sort()).toEqual([...ROLES_ANALITICA].sort());
  });

  it("los tres valores del dominio se usan y ninguno es un literal inventado", () => {
    for (const rol of ROLES_ANALITICA) {
      expect(["total", "acotado", "prohibido"], rol).toContain(ALCANCE_PRODUCTOS[rol]);
    }
  });

  it("la tabla es la que dice el pedido humano, escrita a mano", () => {
    // Aserción LITERAL y no derivada: esta tabla ES el contrato de quién ve productos. Comparar
    // `ALCANCE_PRODUCTOS` contra sí misma estaría siempre verde.
    expect({ ...ALCANCE_PRODUCTOS }).toEqual({
      maestro: "total",
      admin: "total",
      adminSatelite: "prohibido",
      adminTienda: "acotado",
      mensajero: "prohibido",
    });
  });
});

describe("R2 · acceso total: maestro y admin cuentan sobre TODAS las tiendas", () => {
  it("maestro resuelve `global`", () => {
    expect(resolverAlcanceProductos(ACTOR("maestro"))).toEqual({
      estado: "ok",
      alcance: { tipo: "global" },
    });
  });

  it("admin resuelve `global`", () => {
    expect(resolverAlcanceProductos(ACTOR("admin"))).toEqual({
      estado: "ok",
      alcance: { tipo: "global" },
    });
  });

  it("`global` no lleva ningun id: no hay nada que recortar", () => {
    const resuelto = resolverAlcanceProductos(ACTOR("maestro"));
    expect(resuelto.estado === "ok" && Object.keys(resuelto.alcance)).toEqual(["tipo"]);
  });
});

describe("R3 · adminTienda queda acotado a SU tienda", () => {
  it("resuelve `tienda` con su propio `usuarioId`", () => {
    // En este esquema el `adminTienda` ES la tienda: `orden.tienda_id` es FK a `usuario`.
    expect(resolverAlcanceProductos(ACTOR("adminTienda"))).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u-propio" },
    });
  });

  it("la tienda sale del ACTOR y nunca de un campo que el actor traiga puesto", () => {
    // La mutacion que este caso mata: leer `actor.tiendaId` en vez de `actor.usuarioId`. Un
    // cliente que se fabricara la sesion podria entonces nombrar la tienda que quisiera.
    const resuelto = resolverAlcanceProductos(ACTOR("adminTienda", { tiendaId: "t-ajena" }));
    expect(resuelto).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u-propio" },
    });
  });
});

describe("R4 · adminSatelite y mensajero NO reciben ninguna cifra", () => {
  it("adminSatelite esta PROHIBIDO, no acotado a su zona", () => {
    // Divergencia deliberada con el conteo de entregas, donde este rol obtiene `{tipo:"zona"}`.
    // Es la razon de que esta vertical tenga tipo opaco propio.
    expect(resolverAlcanceProductos(ACTOR("adminSatelite", { zonaId: "z1" }))).toEqual({
      estado: "denegado",
      motivo: "metrica_prohibida",
    });
  });

  it("mensajero esta PROHIBIDO", () => {
    expect(resolverAlcanceProductos(ACTOR("mensajero"))).toEqual({
      estado: "denegado",
      motivo: "metrica_prohibida",
    });
  });

  it("prohibido no es «acotado a nada»: no devuelve `ok` con un alcance vacio", () => {
    for (const rol of ["adminSatelite", "mensajero"]) {
      const resuelto = resolverAlcanceProductos(ACTOR(rol, { zonaId: "z1" }));
      expect(resuelto.estado, rol).toBe("denegado");
    }
  });
});

describe("R6 · el conjunto `total` es exactamente el de `esAccesoTotal`", () => {
  it("{rol : ALCANCE_PRODUCTOS[rol] === 'total'} == ROLES_ACCESO_TOTAL", () => {
    const totales = ROLES_ANALITICA.filter((rol) => ALCANCE_PRODUCTOS[rol] === "total");
    expect([...totales].sort()).toEqual([...ROLES_ACCESO_TOTAL].sort());
  });

  it("y rol por rol, el que resuelve `global` es el que `esAccesoTotal` reconoce", () => {
    for (const rol of ROLES_ANALITICA) {
      const resuelto = resolverAlcanceProductos(ACTOR(rol, { zonaId: "z1" }));
      const esGlobal = resuelto.estado === "ok" && resuelto.alcance.tipo === "global";
      expect(esGlobal, rol).toBe(esAccesoTotal(rol));
    }
  });
});

describe("Falla CERRADO con cualquier entrada", () => {
  it("un rol inventado es `rol_desconocido`, no un alcance heredado", () => {
    expect(resolverAlcanceProductos(ACTOR("superadmin"))).toEqual({
      estado: "denegado",
      motivo: "rol_desconocido",
    });
  });

  it("`apiKey` no es lector de analitica de sesion y queda fuera", () => {
    expect(resolverAlcanceProductos(ACTOR("apiKey"))).toEqual({
      estado: "denegado",
      motivo: "rol_desconocido",
    });
  });

  it("el label de la base («Admin Tienda») no es el rol («adminTienda»)", () => {
    expect(resolverAlcanceProductos(ACTOR("Admin Tienda")).estado).toBe("denegado");
  });

  it("`null`, `undefined` y `{}` son `sin_sesion`", () => {
    expect(resolverAlcanceProductos(null)).toEqual({ estado: "denegado", motivo: "sin_sesion" });
    expect(resolverAlcanceProductos(undefined)).toEqual({
      estado: "denegado",
      motivo: "sin_sesion",
    });
    expect(resolverAlcanceProductos({} as ActorAnalitica)).toEqual({
      estado: "denegado",
      motivo: "sin_sesion",
    });
  });

  it("un `usuarioId` vacio o no-cadena es `sin_sesion`", () => {
    for (const usuarioId of ["", null, 7, {}, undefined]) {
      const actor = { usuarioId, rol: "adminTienda" } as unknown as ActorAnalitica;
      expect(resolverAlcanceProductos(actor), JSON.stringify(usuarioId)).toEqual({
        estado: "denegado",
        motivo: "sin_sesion",
      });
    }
  });

  it("un rol que no es cadena no se compara con nada", () => {
    for (const rol of [7, null, {}, [], true, undefined]) {
      const actor = { usuarioId: "u1", rol } as unknown as ActorAnalitica;
      expect(resolverAlcanceProductos(actor), JSON.stringify(rol)).toEqual({
        estado: "denegado",
        motivo: "rol_desconocido",
      });
    }
  });

  it("NINGUNA entrada hace lanzar: la funcion es TOTAL", () => {
    const basura: unknown[] = [
      null,
      undefined,
      {},
      [],
      7,
      "maestro",
      true,
      { usuarioId: "u1" },
      { rol: "maestro" },
      { usuarioId: 1, rol: 2 },
      Object.create(null),
    ];
    for (const entrada of basura) {
      expect(
        () => resolverAlcanceProductos(entrada as ActorAnalitica),
        JSON.stringify(entrada),
      ).not.toThrow();
      // Y ninguna concede sin ser un actor legitimo.
      const resuelto = resolverAlcanceProductos(entrada as ActorAnalitica);
      expect(resuelto.estado, JSON.stringify(entrada)).toBe("denegado");
    }
  });
});
