import { describe, it, expect, vi } from "vitest";

import {
  claveDeConteoEntregas,
  claveDeConteoPorStatus,
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoPorStatusRepository } from "@/lib/interfaces/repositories/IConteoPorStatusRepository";
import { ConteoPorStatusService } from "@/lib/services/ConteoPorStatusService";
import type { ConteoPorStatusDTO } from "@/lib/types/conteo-por-status";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol: "maestro" }, AHORA);
  if (preparada.status !== "ok") throw new Error("filtro de prueba inválido");
  return preparada.consulta;
}

function repoQueDevuelve(filas: { status: string; conteo: number }[]): IConteoPorStatusRepository {
  return { contarPorStatus: vi.fn().mockResolvedValue(filas) };
}

/** Caché de mentira con memoria real: sirve lo guardado sin re-ejecutar el productor. */
function cacheConMemoria() {
  const entradas = new Map<string, unknown>();
  const ejecuciones: string[] = [];
  const cache: IAnaliticaCache = {
    async envolver(clave, _tags, producir) {
      if (entradas.has(clave)) return entradas.get(clave) as never;
      ejecuciones.push(clave);
      const valor = await producir();
      entradas.set(clave, valor);
      return valor;
    },
    async invalidar() {},
  };
  return { cache, entradas, ejecuciones };
}

describe("Servicio por status — el total", () => {
  // El total se DERIVA de los mismos buckets que viajan. Si saliera de una segunda consulta,
  // una escritura entre las dos dejaría en pantalla un total que no es la suma de lo de abajo.
  it("es la suma exacta de los buckets", async () => {
    const service = new ConteoPorStatusService(
      repoQueDevuelve([
        { status: "entregada", conteo: 20 },
        { status: "en_reparto", conteo: 8 },
        { status: "devuelta", conteo: 2 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.total).toBe(30);
    expect(datos.porStatus.reduce((s, f) => s + f.conteo, 0)).toBe(datos.total);
  });

  it("un universo vacío es una lista vacía y total 0", async () => {
    const service = new ConteoPorStatusService(repoQueDevuelve([]), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect(await service.consultar(consultaDe())).toMatchObject({ porStatus: [], total: 0 });
  });

  // El orden lo fija el repositorio (mayor a menor). El servicio NO reordena: el color de cada
  // porción se asigna por posición, así que dos criterios de orden repintarían los mismos
  // datos con colores distintos según quién los tocara al final.
  it("conserva el orden que trajo el repositorio", async () => {
    const service = new ConteoPorStatusService(
      repoQueDevuelve([
        { status: "entregada", conteo: 20 },
        { status: "en_reparto", conteo: 8 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    expect((await service.consultar(consultaDe())).porStatus.map((f) => f.status)).toEqual([
      "entregada",
      "en_reparto",
    ]);
  });
});

describe("Servicio por status — el sello y la caché", () => {
  it("`lastSync` sale del reloj inyectado", async () => {
    const service = new ConteoPorStatusService(
      repoQueDevuelve([{ status: "entregada", conteo: 1 }]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    expect((await service.consultar(consultaDe())).lastSync).toBe("2026-08-17T12:00:00.000Z");
  });

  // Mismo caso que en el servicio hermano, y por el mismo motivo: el sello dice cuándo se
  // LEYÓ, no cuándo se sirvió. Sellarlo fuera del productor mentiría en cada acierto de caché.
  it("con la caché caliente NO se refresca el sello, y la base se toca una vez", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-17T12:00:00.000Z");
    const repo = repoQueDevuelve([{ status: "entregada", conteo: 1 }]);
    const service = new ConteoPorStatusService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());
    reloj = new Date("2026-08-17T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(repo.contarPorStatus).toHaveBeenCalledTimes(1);
  });
});

describe("Las dos lecturas NO comparten entrada de caché", () => {
  // ⚠ EL CASO QUE JUSTIFICA EL PREFIJO. Las dos comparten `ConsultaConteoEntregas` ENTERA —el
  // filtro es idéntico a propósito— así que sin prefijo producirían la MISMA clave con valores
  // de forma distinta: quien pidiera el desglose recibiría el `{entregadas, noEntregadas}` del
  // otro endpoint. No es una cifra equivocada, es un objeto de otro tipo llegando a un
  // consumidor que no lo espera.
  it("la misma consulta da dos claves distintas", () => {
    const consulta = consultaDe({ zona_id: ["z1"] });

    expect(claveDeConteoPorStatus(consulta)).not.toBe(claveDeConteoEntregas(consulta));
  });

  // Y el resto de la clave sigue discriminando igual: el prefijo se añade, no sustituye.
  it("sigue distinguiendo alcance y filtro dentro de su propio espacio", () => {
    const base = consultaDe();
    const conZona = consultaDe({ zona_id: ["z1"] });
    const otroAlcance: ConsultaConteoEntregas = {
      ...base,
      alcance: { tipo: "tienda", tiendaId: "t1" },
    };

    const claves = [base, conZona, otroAlcance].map(claveDeConteoPorStatus);
    expect(new Set(claves).size).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* El borde                                                                    */
/* -------------------------------------------------------------------------- */

const DATOS: ConteoPorStatusDTO = {
  porStatus: [{ status: "entregada", conteo: 20 }],
  total: 20,
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

describe("El borde por status — la misma puerta que el otro conteo", () => {
  it("el camino feliz devuelve el desglose", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoPorStatus({}, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("acepta las MISMAS siete facetas que el conteo de entregas", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoPorStatus(
      {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-16",
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

    await consultarConteoPorStatus({}, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  it("un filtro inválido no toca el servicio ni el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarConteoPorStatus({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  // El mensajero no ve analítica, y esta puerta no es una excepción. La auditoría se comprueba
  // sobre el LOGGER: lanzar un `ForbiddenError` y confiar en `withErrorHandler` daría un 403
  // MUDO (la trampa heredada de la 126).
  it("el mensajero es `forbidden` y queda AUDITADO, con su propio nombre", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarConteoPorStatus({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      // Distinto al de la otra acción: si compartieran nombre, una denegación no diría cuál de
      // las dos puertas se tocó.
      metricaId: "conteo_por_status",
    });
  });

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarConteoPorStatus({}, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir datos ajenos es `forbidden` y no una lista vacía", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoPorStatus({ tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
