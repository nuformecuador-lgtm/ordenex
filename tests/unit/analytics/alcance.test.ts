import { describe, it, expect, vi, afterEach } from "vitest";
import { RolValue } from "@prisma/client";
import {
  resolverAlcance,
  ROLES_ANALITICA_INTEGRACION,
  ROLES_SIN_ANALITICA,
} from "@/lib/analytics/alcance";
import { METRICAS_API_KEY } from "@/lib/analytics/publicacion-api-key";
import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";
import { METRICAS } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";

// Feature 122 / T2.2-T2.3 — comportamiento del resolutor de alcance.
//
// Requisitos cubiertos aqui: R1 (total y discriminado), R2 (total => global), R4 (zona),
// R6 (tienda), R7 (mensajero), R9-R14 (fallo cerrado) y R34 (motivos sin datos, sin logs).
//
// Los casos NEGATIVOS son el requisito principal, no un extra: sin RLS debajo, cada
// `denegado` que se degrade a `ok` filtra las filas de otro inquilino.

const ACTOR: Record<RolAnalitica, ActorAnalitica> = {
  maestro: { usuarioId: "u-maestro", rol: "maestro" },
  admin: { usuarioId: "u-admin", rol: "admin" },
  adminSatelite: { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: "z1" },
  adminTienda: { usuarioId: "u-tienda", rol: "adminTienda" },
  mensajero: { usuarioId: "u-mensajero", rol: "mensajero" },
};

const OPERATIVAS = METRICAS.filter((m) => m.dominio === "operativa");
const FINANCIERAS = METRICAS.filter((m) => m.dominio === "financiera");

/** La union literal declarada en el modulo. Ningun motivo puede salirse de aqui (R34). */
const MOTIVOS: readonly MotivoDenegacion[] = [
  "sin_sesion",
  "rol_desconocido",
  "rol_sin_analitica",
  "sin_zona_asignada",
  "metrica_desconocida",
  "metrica_prohibida",
  "filtro_fuera_de_alcance",
];

describe("R1 · el resolutor es total y devuelve un resultado discriminado", () => {
  it("devuelve ok o denegado para las 5 x 25 combinaciones de rol y metrica", () => {
    expect(ROLES_ANALITICA.length).toBe(5);
    expect(METRICAS.length).toBe(25); // 23 de la 135 + 2 financieras de la 173 (P4)

    let casos = 0;
    for (const rol of ROLES_ANALITICA) {
      for (const metrica of METRICAS) {
        const r = resolverAlcance(ACTOR[rol], metrica.id);
        expect(["ok", "denegado"], `${rol}/${metrica.id}`).toContain(r.estado);
        casos++;
      }
    }
    expect(casos).toBe(125);
  });

  it("no lanza con entradas basura: null, undefined, objeto vacio, rol numerico", () => {
    const basura: unknown[] = [
      null,
      undefined,
      {},
      { usuarioId: 1, rol: 2 },
      { usuarioId: "u1", rol: 7 },
      { usuarioId: "", rol: "maestro" },
      "no soy un actor",
      42,
      [],
    ];
    for (const entrada of basura) {
      expect(
        () => resolverAlcance(entrada as ActorAnalitica | null, "entregas"),
        JSON.stringify(entrada),
      ).not.toThrow();
      expect(resolverAlcance(entrada as ActorAnalitica | null, "entregas").estado).toBe("denegado");
    }
  });

  it("no lanza con un metricaId que no es cadena y lo trata como metrica desconocida", () => {
    const r = resolverAlcance(ACTOR.maestro, 123 as unknown as string);
    expect(r).toEqual({ estado: "denegado", motivo: "metrica_desconocida" });
  });
});

describe("R2 · alcance total del catalogo => alcance global", () => {
  it("todo rol con alcance total en la metrica resuelve global, sin recorte de filas", () => {
    let comprobados = 0;
    for (const rol of ROLES_ANALITICA) {
      for (const metrica of METRICAS) {
        if (metrica.alcance[rol] !== "total") continue;
        expect(resolverAlcance(ACTOR[rol], metrica.id), `${rol}/${metrica.id}`).toEqual({
          estado: "ok",
          alcance: { tipo: "global" },
        });
        comprobados++;
      }
    }
    // 2 roles de acceso total x 25 metricas.
    expect(comprobados).toBe(50);
  });
});

describe("R4 · adminSatelite + metrica acotada => alcance de zona", () => {
  it("resuelve la zona del actor y no otra", () => {
    for (const metrica of OPERATIVAS) {
      expect(resolverAlcance(ACTOR.adminSatelite, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "zona", zonaId: "z1" },
      });
    }
  });

  it("la zona sale del actor: cambiarla cambia el alcance", () => {
    const otro: ActorAnalitica = { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: "z9" };
    expect(resolverAlcance(otro, "entregas")).toEqual({
      estado: "ok",
      alcance: { tipo: "zona", zonaId: "z9" },
    });
  });
});

describe("R6 · adminTienda + metrica acotada => alcance de tienda = su propio usuarioId", () => {
  it("la tienda es el usuarioId del actor, porque el adminTienda ES la tienda", () => {
    for (const metrica of OPERATIVAS) {
      expect(resolverAlcance(ACTOR.adminTienda, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "tienda", tiendaId: "u-tienda" },
      });
    }
  });

  it("no toma la tienda de ningun otro campo del actor", () => {
    const conRuido = {
      ...ACTOR.adminTienda,
      zonaId: "z-ajena",
      tiendaId: "tienda-ajena",
    } as ActorAnalitica;
    expect(resolverAlcance(conRuido, "entregas")).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u-tienda" },
    });
  });
});

describe("R7 · mensajero + metrica acotada => alcance de mensajero = su propio usuarioId", () => {
  it("resuelve el mismo alcance de mensajero para TODA metrica, sin excepcion por unidadDeConteo", () => {
    const porGestion = OPERATIVAS.filter((m) => m.unidadDeConteo === "gestion");
    expect(porGestion.length).toBeGreaterThan(0);

    for (const metrica of OPERATIVAS) {
      expect(resolverAlcance(ACTOR.mensajero, metrica.id), metrica.id).toEqual({
        estado: "ok",
        alcance: { tipo: "mensajero", mensajeroId: "u-mensajero" },
      });
    }
  });
});

describe("R9 · metrica prohibida => denegado, ni siquiera recortada", () => {
  it("las 10 financieras x los 3 roles sin dinero dan 30 denegados por metrica_prohibida", () => {
    expect(FINANCIERAS.length).toBe(10);
    const sinDinero: RolAnalitica[] = ["adminSatelite", "adminTienda", "mensajero"];

    let casos = 0;
    for (const rol of sinDinero) {
      for (const metrica of FINANCIERAS) {
        expect(resolverAlcance(ACTOR[rol], metrica.id), `${rol}/${metrica.id}`).toEqual({
          estado: "denegado",
          motivo: "metrica_prohibida",
        });
        casos++;
      }
    }
    expect(casos).toBe(30);
  });
});

describe("R10 · sin sesion => denegado/sin_sesion", () => {
  it("actor null y actor undefined dan sin_sesion", () => {
    expect(resolverAlcance(null, "entregas")).toEqual({ estado: "denegado", motivo: "sin_sesion" });
    expect(resolverAlcance(undefined, "entregas")).toEqual({
      estado: "denegado",
      motivo: "sin_sesion",
    });
  });

  it("un actor sin usuarioId util tambien es sin_sesion", () => {
    for (const roto of [{ rol: "maestro" }, { usuarioId: "", rol: "maestro" }]) {
      expect(resolverAlcance(roto as ActorAnalitica, "entregas")).toEqual({
        estado: "denegado",
        motivo: "sin_sesion",
      });
    }
  });
});

// FEATURE 267 (2026-08-23) — este bloque se REEXPRESA, no se relaja. Hasta hoy afirmaba
// «apiKey NUNCA consume analitica (122/R11-D9)». La 267 revierte esa decision SOLO para el
// canal por API key: el rol sigue denegado por el canal de sesion, que es lo que este
// archivo comprueba con la aridad de siempre (sin tercer argumento). La concesion por
// `canal: "api_key"` tiene su propio archivo, `alcance-api-key.test.ts`.
describe("R11 (122) / R6 (267) · apiKey no consume analitica POR EL CANAL DE SESION", () => {
  it("rol apiKey da rol_sin_analitica en las 25 metricas, con el canal por defecto", () => {
    const integrador: ActorAnalitica = { usuarioId: "u-api", rol: "apiKey" };
    for (const metrica of METRICAS) {
      expect(resolverAlcance(integrador, metrica.id), metrica.id).toEqual({
        estado: "denegado",
        motivo: "rol_sin_analitica",
      });
    }
  });

  it("tampoco por el canal interno explicito, ni para una metrica publicable por API key", () => {
    const integrador: ActorAnalitica = { usuarioId: "u-api", rol: "apiKey" };
    expect(METRICAS_API_KEY.length).toBeGreaterThan(0);
    for (const id of METRICAS_API_KEY) {
      expect(resolverAlcance(integrador, id, "interno"), id).toEqual({
        estado: "denegado",
        motivo: "rol_sin_analitica",
      });
    }
  });

  it("apiKey se deniega ANTES de mirar el catalogo: tampoco filtra si la metrica existe", () => {
    const integrador: ActorAnalitica = { usuarioId: "u-api", rol: "apiKey" };
    expect(resolverAlcance(integrador, "no_existe")).toEqual({
      estado: "denegado",
      motivo: "rol_sin_analitica",
    });
  });
});

describe("R12 · rol fuera de RolValue => denegado/rol_desconocido, sin rama default", () => {
  it("los SEIS RolValue del esquema reciben veredicto explicito y ninguno cae en un default permisivo", () => {
    const roles = Object.values(RolValue);
    expect(roles.length).toBe(6);

    for (const rol of roles) {
      const actor: ActorAnalitica = { usuarioId: "u1", rol, zonaId: "z1" };
      const r = resolverAlcance(actor, "entregas");
      // 267: la particion es ternaria. Por el canal de sesion (aridad de siempre) los DOS
      // complementos de `ROLES_ANALITICA` se deniegan igual; lo que cambia es DONDE se
      // declara el rol, no el veredicto.
      const denegadoPorRol =
        (ROLES_SIN_ANALITICA as readonly string[]).includes(rol) ||
        (ROLES_ANALITICA_INTEGRACION as readonly string[]).includes(rol);
      if (denegadoPorRol) {
        expect(r, rol).toEqual({ estado: "denegado", motivo: "rol_sin_analitica" });
      } else {
        expect(r.estado, rol).toBe("ok");
      }
    }
  });

  it("un rol inventado y el label de la DB 'Admin Tienda' dan rol_desconocido", () => {
    for (const rol of ["inventado", "Admin Tienda", "MAESTRO", "admin ", ""]) {
      expect(resolverAlcance({ usuarioId: "u1", rol }, "entregas"), rol).toEqual({
        estado: "denegado",
        motivo: "rol_desconocido",
      });
    }
  });
});

describe("R13 · adminSatelite sin zona => denegado/sin_zona_asignada (D2)", () => {
  it("zonaId null, cadena vacia y ausente dan sin_zona_asignada y nunca global", () => {
    const casos: ActorAnalitica[] = [
      { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: null },
      { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: "" },
      { usuarioId: "u-satelite", rol: "adminSatelite" },
    ];
    for (const actor of casos) {
      const r = resolverAlcance(actor, "entregas");
      expect(r).toEqual({ estado: "denegado", motivo: "sin_zona_asignada" });
      expect(JSON.stringify(r)).not.toContain("global");
    }
  });

  it("un adminSatelite sin zona no ve NINGUNA metrica operativa", () => {
    const sinZona: ActorAnalitica = { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: null };
    for (const metrica of OPERATIVAS) {
      expect(resolverAlcance(sinZona, metrica.id).estado, metrica.id).toBe("denegado");
    }
  });
});

describe("R14 · metrica inexistente => denegado/metrica_desconocida", () => {
  it("un id que no esta en el catalogo se deniega para todos los roles", () => {
    for (const rol of ROLES_ANALITICA) {
      expect(resolverAlcance(ACTOR[rol], "no_existe"), rol).toEqual({
        estado: "denegado",
        motivo: "metrica_desconocida",
      });
    }
  });
});

describe("R34 · los motivos son literales cerrados y el modulo no loguea", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("todo motivo emitido pertenece a la union declarada y no contiene ids ni PII", () => {
    const uuid = "3f1c2a44-0000-4000-8000-abcdefabcdef";
    const entradas: (ActorAnalitica | null)[] = [
      null,
      { usuarioId: uuid, rol: "apiKey" },
      { usuarioId: uuid, rol: "inventado" },
      { usuarioId: uuid, rol: "adminSatelite", zonaId: null },
      { usuarioId: uuid, rol: "adminTienda" },
    ];

    for (const actor of entradas) {
      for (const metricaId of [...METRICAS.map((m) => m.id), "no_existe"]) {
        const r = resolverAlcance(actor, metricaId);
        if (r.estado !== "denegado") continue;
        expect(MOTIVOS).toContain(r.motivo);
        expect(JSON.stringify(r)).not.toContain(uuid);
      }
    }
  });

  it("resolver un alcance no escribe nada en consola", () => {
    const espias = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    for (const rol of ROLES_ANALITICA) {
      for (const metrica of METRICAS) resolverAlcance(ACTOR[rol], metrica.id);
    }
    resolverAlcance(null, "no_existe");

    expect(espias.log).not.toHaveBeenCalled();
    expect(espias.warn).not.toHaveBeenCalled();
    expect(espias.error).not.toHaveBeenCalled();
  });
});
