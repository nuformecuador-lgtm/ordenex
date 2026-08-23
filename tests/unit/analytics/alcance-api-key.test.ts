import { describe, it, expect, vi } from "vitest";

// R11 — el resolutor es puro y NO puede tocar la base. El espia se declara antes de
// importar nada de analitica para que el mock este montado si algo lo intentara.
const getPrismaClient = vi.fn(() => {
  throw new Error("el resolutor de alcance no puede abrir una conexion a la base");
});
vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient }));

import {
  resolverAlcance,
  ROLES_ANALITICA_INTEGRACION,
  ROLES_SIN_ANALITICA,
} from "@/lib/analytics/alcance";
import type { ActorAnalitica, AlcanceDatos, CanalAnalitica } from "@/lib/analytics/alcance";
import { METRICAS } from "@/lib/analytics/metrics";
import { METRICAS_API_KEY } from "@/lib/analytics/publicacion-api-key";

// Feature 267 / T2 — la reversion de 122/R11-D9, con su limite (R1, R2, R6, R11, R15).
//
// Lo que este archivo protege NO es "que el integrador pueda consultar": es que pueda
// consultar SOLO por su canal, SOLO su tienda y SOLO lo publicado. Cada caso negativo de
// aqui es, sin RLS debajo, la unica separacion entre inquilinos.

const INTEGRADOR: ActorAnalitica = { usuarioId: "u-api-key-1", rol: "apiKey" };
const OTRO_INTEGRADOR: ActorAnalitica = { usuarioId: "u-api-key-2", rol: "apiKey" };
const PUBLICABLE = METRICAS_API_KEY[0];
const NO_PUBLICABLE = METRICAS.map((m) => m.id).filter(
  (id) => !(METRICAS_API_KEY as readonly string[]).includes(id),
);

describe("R1 · un actor apiKey por el canal api_key recibe alcance de SU tienda", () => {
  it("el alcance es tipo tienda con el usuarioId del propio actor", () => {
    expect(resolverAlcance(INTEGRADOR, PUBLICABLE, "api_key")).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u-api-key-1" },
    });
  });

  it("las diez metricas publicables se conceden, y todas con el mismo sujeto", () => {
    expect(METRICAS_API_KEY.length).toBeGreaterThan(0);
    for (const id of METRICAS_API_KEY) {
      expect(resolverAlcance(INTEGRADOR, id, "api_key"), id).toEqual({
        estado: "ok",
        alcance: { tipo: "tienda", tiendaId: INTEGRADOR.usuarioId },
      });
    }
  });

  it("dos integradores distintos NO comparten sujeto: el recorte sale del actor, no de la peticion", () => {
    const a = resolverAlcance(INTEGRADOR, PUBLICABLE, "api_key");
    const b = resolverAlcance(OTRO_INTEGRADOR, PUBLICABLE, "api_key");
    expect(a).not.toEqual(b);
    expect(b).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u-api-key-2" },
    });
  });
});

describe("R6 · el MISMO actor por el canal interno sigue denegado", () => {
  it("sin tercer argumento (default interno) la metrica publicable se deniega", () => {
    expect(resolverAlcance(INTEGRADOR, PUBLICABLE)).toEqual({
      estado: "denegado",
      motivo: "rol_sin_analitica",
    });
  });

  it("con canal interno explicito tambien, y para las 25 metricas del catalogo", () => {
    for (const metrica of METRICAS) {
      expect(resolverAlcance(INTEGRADOR, metrica.id, "interno"), metrica.id).toEqual({
        estado: "denegado",
        motivo: "rol_sin_analitica",
      });
    }
  });

  it("por el canal interno se deniega ANTES de mirar la metrica: no es un oraculo del catalogo", () => {
    // Mismo motivo para una metrica publicable, una prohibida y una inexistente: por
    // sesion, el integrador no puede distinguir que existe.
    const motivos = new Set(
      [PUBLICABLE, "cod_recaudado", "no_existe"].map(
        (id) => resolverAlcance(INTEGRADOR, id, "interno").estado + ":" + JSON.stringify(resolverAlcance(INTEGRADOR, id, "interno")),
      ),
    );
    expect(motivos.size).toBe(1);
  });

  it("ningun canal distinto de api_key concede, ni siquiera uno inventado", () => {
    for (const canal of ["interno", "API_KEY", "api-key", "", "webhook"]) {
      expect(resolverAlcance(INTEGRADOR, PUBLICABLE, canal as CanalAnalitica), canal).toEqual({
        estado: "denegado",
        motivo: "rol_sin_analitica",
      });
    }
  });
});

describe("R15 · por el canal api_key solo se concede lo publicado", () => {
  it("una metrica del catalogo fuera de la lista blanca se deniega", () => {
    expect(NO_PUBLICABLE.length).toBeGreaterThan(0);
    for (const id of NO_PUBLICABLE) {
      const r = resolverAlcance(INTEGRADOR, id, "api_key");
      expect(r.estado, id).toBe("denegado");
      expect(r, id).toEqual({ estado: "denegado", motivo: "metrica_prohibida" });
    }
  });

  it("una metrica que no existe se deniega como desconocida, y un metricaId que no es cadena tampoco lanza", () => {
    expect(resolverAlcance(INTEGRADOR, "no_existe", "api_key")).toEqual({
      estado: "denegado",
      motivo: "metrica_desconocida",
    });
    expect(() =>
      resolverAlcance(INTEGRADOR, 123 as unknown as string, "api_key"),
    ).not.toThrow();
    expect(resolverAlcance(INTEGRADOR, 123 as unknown as string, "api_key")).toEqual({
      estado: "denegado",
      motivo: "metrica_desconocida",
    });
  });

  it("ninguna financiera se concede por este canal", () => {
    for (const m of METRICAS.filter((x) => x.dominio === "financiera")) {
      expect(resolverAlcance(INTEGRADOR, m.id, "api_key").estado, m.id).toBe("denegado");
    }
  });
});

describe("R11 · sin usuarioId util se deniega, y sin tocar la base", () => {
  it("actor null, sin id, con id vacio o con id no-cadena dan sin_sesion", () => {
    const rotos: unknown[] = [
      null,
      undefined,
      {},
      { rol: "apiKey" },
      { usuarioId: "", rol: "apiKey" },
      { usuarioId: 7, rol: "apiKey" },
    ];
    for (const roto of rotos) {
      expect(
        resolverAlcance(roto as ActorAnalitica | null, PUBLICABLE, "api_key"),
        JSON.stringify(roto),
      ).toEqual({ estado: "denegado", motivo: "sin_sesion" });
    }
  });

  it("ningun camino de este archivo ha abierto una conexion a la base", () => {
    resolverAlcance(INTEGRADOR, PUBLICABLE, "api_key");
    resolverAlcance(null, PUBLICABLE, "api_key");
    expect(getPrismaClient).not.toHaveBeenCalled();
  });
});

describe("R2/R5 · la forma del modulo no cambia con la reversion", () => {
  it("AlcanceDatos sigue teniendo CUATRO variantes y ninguna nueva para el integrador", () => {
    // Si alguien anadiese una quinta variante, este `switch` exhaustivo dejaria de
    // compilar (o el literal nuevo no seria asignable) y el guardia de `claveDeAlcance`
    // caeria detras.
    const variantes: AlcanceDatos[] = [
      { tipo: "global" },
      { tipo: "zona", zonaId: "z1" },
      { tipo: "tienda", tiendaId: "t1" },
      { tipo: "mensajero", mensajeroId: "m1" },
    ];
    const tipos = variantes.map((v) => v.tipo);
    expect(new Set(tipos).size).toBe(4);
    for (const v of variantes) {
      const nombre: string = ((): string => {
        switch (v.tipo) {
          case "global":
            return "global";
          case "zona":
            return "zona";
          case "tienda":
            return "tienda";
          case "mensajero":
            return "mensajero";
        }
      })();
      expect(nombre).toBe(v.tipo);
    }
    // El integrador reusa `tienda`: no hay variante propia.
    const concedido = resolverAlcance(INTEGRADOR, PUBLICABLE, "api_key");
    expect(concedido.estado).toBe("ok");
    if (concedido.estado === "ok") expect(tipos).toContain(concedido.alcance.tipo);
  });

  it("ROLES_SIN_ANALITICA sigue exportada y vacia; el rol de integracion vive en su propia lista", () => {
    expect(ROLES_SIN_ANALITICA).toEqual([]);
    expect([...ROLES_ANALITICA_INTEGRACION]).toEqual(["apiKey"]);
  });
});
