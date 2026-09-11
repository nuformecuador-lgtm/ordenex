import { describe, it, expect, vi } from "vitest";

import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { CohorteCargaDTO } from "@/lib/types/cohorte-carga";

// Ficha 411 / T5.2 — EL BORDE de la cohorte (R5, R21, R22, R23, R25, R26).
//
// ─── EL ORDEN DEL BORDE, QUE ES LO QUE ESTE ARCHIVO EXISTE PARA ATORNILLAR ──────────────
//
//   parsear (zod)  ->  ¿alcance?  ->  ¿hay rango?  ->  consultar
//      | falla         | deniega      | no hay
//   validation_error   forbidden /    sin_rango
//                      unauthenticated
//
// LA DENEGACION PRECEDE A LA INVITACION. Un `mensajero` sin rango no recibe «elige un periodo»,
// recibe `forbidden`: al reves, el texto seria una sonda de permisos —quien no puede leer esto
// averiguaria que existe y que solo le falta un filtro—. Y una entrada malformada ni siquiera
// llega a preguntar por el alcance, por el mismo motivo.
//
// `sin_rango` NO ES `validation_error`. El filtro es VALIDO: las otras siete lecturas de la
// seccion lo aceptan tal cual y devuelven datos. Lo que pasa es que ESTA lectura exige rango
// (sin techo, la tabla crece hasta una fila por cada dia que alguna vez tuvo carga). Mezclarlos
// diria que el usuario se equivoco cuando lo que pasa es que aun no ha elegido.

const AHORA = new Date("2026-08-17T12:00:00.000Z");
const RANGO = { rango: "personalizado" as const, desde: "2026-08-10", hasta: "2026-08-16" };

const DATOS: CohorteCargaDTO = {
  porDia: [
    {
      fecha: "2026-08-16",
      cargadas: 3,
      cubos: [{ desenlace: "entregada", n: 3, segundosAcum: 3600, promedioSegundos: 1200 }],
    },
  ],
  total: 3,
  totalPorDesenlace: [
    { desenlace: "entregada", n: 3, segundosAcum: 3600, promedioSegundos: 1200 },
  ],
  lastSync: "2026-08-17T12:00:00.000Z",
};

function deps(actor: unknown) {
  const service = { consultar: vi.fn(async (_c: ConsultaConteoEntregas) => DATOS) };
  const logger = { logError: vi.fn() };
  return {
    deps: { service, logger, getActor: async () => actor as never, now: () => AHORA },
    service,
    logger,
  };
}

describe("R26 · el camino feliz", () => {
  it("con rango y alcance devuelve `ok` con los datos", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarCohorteCarga(RANGO, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("acepta las MISMAS seis facetas que el resto de la vertical", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarCohorteCarga(
      {
        ...RANGO,
        zona_id: ["z1"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
        mensajero_id: ["m1"],
      },
      d,
    );

    expect(res.status).toBe("ok");
    expect(service.consultar).toHaveBeenCalledTimes(1);
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    await consultarCohorteCarga(RANGO, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  // P2: el adminSatelite VE la seccion, con su alcance de zona. No hay excepcion de permisos
  // propia de esta tabla.
  it("el adminSatelite lee la seccion, acotado a su zona", async () => {
    const { deps: d, service } = deps({ usuarioId: "s1", rol: "adminSatelite", zonaId: "z7" });

    const res = await consultarCohorteCarga(RANGO, d);

    expect(res.status).toBe("ok");
    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "zona", zonaId: "z7" },
    });
  });
});

describe("R5 · sin rango se INVITA, no se falla", () => {
  it("un filtro valido SIN rango es `sin_rango`, y no toca el servicio ni la cache", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarCohorteCarga({}, d);

    expect(res).toEqual({ status: "sin_rango" });
    // Ni base, ni cache, ni servicio: `sin_rango` sale ANTES de construir nada.
    expect(service.consultar).not.toHaveBeenCalled();
    // Y no se audita: no hay denegado que registrar, el usuario no hizo nada mal.
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("`sin_rango` NO es `validation_error` ni una tabla vacia", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarCohorteCarga({ zona_id: ["z1"] }, d);

    expect(res.status).toBe("sin_rango");
    expect(res.status).not.toBe("validation_error");
    expect(res).not.toHaveProperty("datos");
    expect(res).not.toHaveProperty("fieldErrors");
  });

  // ⚠ LA DENEGACION PRECEDE A LA INVITACION. Si el orden se invirtiera, un mensajero sin rango
  // recibiria «elige un periodo» y sabria que la seccion existe.
  it("un `mensajero` SIN rango es `forbidden`, no `sin_rango`", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    const res = await consultarCohorteCarga({}, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  it("sin sesion y sin rango es `unauthenticated`, no `sin_rango`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarCohorteCarga({}, d)).toEqual({ status: "unauthenticated" });
  });
});

describe("R21/R22 · quien no puede leer, no lee", () => {
  it("el `mensajero` es `forbidden` y no toca el repositorio", async () => {
    const { deps: d, service } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarCohorteCarga(RANGO, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  // El canal de API key no es lector de analitica: `apiKey` no esta en `ROLES_ANALITICA` y lo
  // para el mismo sitio que a un rol inventado.
  it("el canal `apiKey` es `forbidden` y no toca el repositorio", async () => {
    const { deps: d, service } = deps({ usuarioId: "k1", rol: "apiKey" });

    expect(await consultarCohorteCarga(RANGO, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("un rol inventado tambien cae", async () => {
    const { deps: d, service } = deps({ usuarioId: "x1", rol: "SuperAdmin" });

    expect(await consultarCohorteCarga(RANGO, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("sin sesion es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    // «No sabemos quien eres» se arregla volviendo a entrar y «no puedes» no: la pantalla ya
    // tiene dos textos para eso.
    expect(await consultarCohorteCarga(RANGO, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir la tienda de otro es `forbidden`, no una cohorte vacia", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarCohorteCarga({ ...RANGO, tienda_id: ["ajena"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    // NO se devuelve `ok` con el subconjunto vacio de la interseccion: un tablero vacio se
    // reporta como bug de datos y esconde el intento.
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("pedir una zona ajena tambien es `forbidden`", async () => {
    const { deps: d, service } = deps({ usuarioId: "s1", rol: "adminSatelite", zonaId: "z7" });

    expect(await consultarCohorteCarga({ ...RANGO, zona_id: ["z9"] }, d)).toEqual({
      status: "forbidden",
    });
    expect(service.consultar).not.toHaveBeenCalled();
  });
});

describe("R23 · el alcance NUNCA entra por el filtro", () => {
  it("una clave desconocida es `validation_error`", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarCohorteCarga({ ...RANGO, rol: "maestro" }, d);

    expect(res.status).toBe("validation_error");
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("y se rechaza SIN preguntar por el alcance", async () => {
    // Sin sesion + filtro invalido: si el alcance se resolviera primero, esto seria
    // `unauthenticated`. Que salga `validation_error` demuestra el orden — y es lo que impide
    // que una entrada malformada sirva de sonda de permisos.
    const { deps: d, logger } = deps(null);

    expect((await consultarCohorteCarga({ clave_inventada: 1 }, d)).status).toBe(
      "validation_error",
    );
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("un rango invalido tambien es `validation_error`, no `sin_rango`", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarCohorteCarga({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
    expect(
      (await consultarCohorteCarga({ rango: "personalizado", desde: "2026-08-16" }, d)).status,
    ).toBe("validation_error");
  });
});

describe("R25 · el denegado deja rastro, y el motivo no viaja al cliente", () => {
  it("audita con su propio nombre y su motivo", async () => {
    const { deps: d, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    await consultarCohorteCarga(RANGO, d);

    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      // Distinto al de las otras siete acciones a proposito: si compartieran nombre, una
      // denegacion no diria cual de las ocho puertas se toco.
      metricaId: "cohorte_carga",
    });
  });

  it("el motivo se queda en el log: la respuesta solo dice `forbidden`", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarCohorteCarga({ ...RANGO, tienda_id: ["ajena"] }, d);

    // Al cliente, el motivo concreto seria una pista sobre el modelo de permisos.
    expect(Object.keys(res)).toEqual(["status"]);
    expect(JSON.stringify(res)).not.toContain("filtro_fuera_de_alcance");
  });
});

describe("R26 · los CINCO estados de la respuesta existen y son distintos", () => {
  it("ok, sin_rango, unauthenticated, forbidden y validation_error", async () => {
    const conSesion = deps({ usuarioId: "u1", rol: "maestro" });
    const mensajero = deps({ usuarioId: "m1", rol: "mensajero" });
    const anonimo = deps(null);

    const estados = [
      (await consultarCohorteCarga(RANGO, conSesion.deps)).status,
      (await consultarCohorteCarga({}, conSesion.deps)).status,
      (await consultarCohorteCarga(RANGO, anonimo.deps)).status,
      (await consultarCohorteCarga(RANGO, mensajero.deps)).status,
      (await consultarCohorteCarga({ rango: "trimestre" }, conSesion.deps)).status,
    ];

    // Ninguno de los cuatro ultimos se representa como una cohorte vacia.
    expect(estados).toEqual([
      "ok",
      "sin_rango",
      "unauthenticated",
      "forbidden",
      "validation_error",
    ]);
    expect(new Set(estados).size).toBe(5);
  });
});
