import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  consultarAnaliticaOperativa,
  consultarAgregadoOperativo,
} from "@/lib/actions/analitica-operativa";
import type { AnaliticaOperativaDeps } from "@/lib/actions/analitica-operativa";
import { METRICAS_API_KEY } from "@/lib/analytics/publicacion-api-key";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";

// Feature 267 (T10, R6/R7/R43) — ABRIR EL CANAL POR API KEY NO ABRIO EL CANAL DE COOKIE.
//
// ESTA ES LA RAZON DE SER DEL PARAMETRO `canal`, y por eso este archivo existe.
//
// La 267 revierte una decision firmada (122/R11–D9: «`apiKey` denegado POR DISEÑO») y hace que
// `resolverAlcance` CONCEDA al rol de integracion. Pero `prepararConsultaAnalitica` es LA MISMA
// funcion para los dos canales: la Server Action del tablero la llama igual que el borde del
// integrador. Una concesion «por rol» a secas habria abierto tambien la puerta de la sesion, y
// las dos features se habrian pisado dentro de la misma funcion sin que nada se pusiera rojo.
//
// Por eso la concesion depende del CANAL, con default `"interno"`, y por eso este test fuerza el
// escenario que hoy no existe: un actor con `rol: "apiKey"` entrando por `deps.getActor`, es
// decir, como si tuviera sesion. Hoy no hay ningun flujo de login por cookie que produzca ese
// rol —esa es la garantia externa—, pero R6 exige que el propio resolutor de alcance sea una
// SEGUNDA capa que no dependa de ella. Si alguien cablease manana un login para la cuenta de
// integracion, o si un actor se construyera a mano en otro borde, esto es lo que impide que el
// tablero interno se abra solo.
//
// Antes de la correccion de diseño del 2026-08-22 (que introdujo el parametro `canal`) este
// mismo test habria FALLADO: el actor `apiKey` habria recibido `ok`.

/** La cuenta dedicada 1:1 de una API key, colada por el canal de SESION. */
const INTEGRADOR: ActorAnalitica = { usuarioId: "u-integrador", rol: "apiKey" };

/** Reloj congelado: misma entrada, misma salida. */
const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** El filtro de la 135, valido: si algo falla, que no sea el parseo. */
const RAW = { rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-03" };

/**
 * Doble del servicio que hace de CONTADOR DEL REPOSITORIO: la Server Action solo llega a la base
 * a traves de el, asi que cero llamadas aqui es cero llamadas alla. Los dos metodos revientan a
 * proposito: si el denegado no cortara antes, el test no devolveria «casi bien», reventaria.
 */
function servicioQueNoDebeUsarse() {
  const consultar = vi.fn(async () => {
    throw new Error("un actor apiKey por SESION jamas debe llegar al servicio");
  });
  const consultarAgregado = vi.fn(async () => {
    throw new Error("un actor apiKey por SESION jamas debe llegar al servicio");
  });
  const service = { consultar, consultarAgregado } as unknown as IAnaliticaOperativaService;
  return { service, consultar, consultarAgregado };
}

function montar() {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const { service, consultar, consultarAgregado } = servicioQueNoDebeUsarse();
  const deps: AnaliticaOperativaDeps = {
    getActor: async () => INTEGRADOR,
    service,
    logger,
    now: () => AHORA,
  };
  return { deps, consultar, consultarAgregado, logError };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("267/R7 · el rol de integracion no gana acceso al tablero", () => {
  it("`ROLES_ACCESO_ANALITICA` sigue teniendo sus CUATRO roles, y `apiKey` no esta", () => {
    // Se deriva restando de `ROLES_ANALITICA` (`lib/auth/menu-visibility.ts`), asi que un sexto
    // rol lector habria entrado SOLO al sidebar y al gate `notFound()` de la ruta. Una cuenta de
    // maquina con item de menu es exactamente el fallo silencioso que R7 prohibe, y es la razon
    // por la que la 267 NO declaro `apiKey` como sexto `RolAnalitica` (design §7.1).
    expect(ROLES_ACCESO_ANALITICA).toHaveLength(4);
    expect(ROLES_ACCESO_ANALITICA).not.toContain("apiKey");
    expect(ROLES_ANALITICA).toHaveLength(5);
    expect([...ROLES_ANALITICA]).not.toContain("apiKey");
  });
});

describe("267/R6 · un actor `apiKey` por SESION recibe forbidden en las DOS Server Actions", () => {
  it("`consultarAnaliticaOperativa`: forbidden, sin datos, sin motivo y sin tocar el servicio", async () => {
    const { deps, consultar } = montar();

    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: RAW },
      deps,
    );

    expect(r.status).toBe("forbidden");
    // Sin datos y sin motivo: el motivo va al log, nunca al cliente (122/R5, 122/R41).
    expect(r).toEqual({ status: "forbidden" });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("`consultarAgregadoOperativo`: lo mismo, por el mismo camino", async () => {
    const { deps, consultarAgregado } = montar();

    // `tasa_entrega` es de unidad agregable, asi que si el denegado NO cortara, esta llamada
    // llegaria al servicio de verdad en vez de rebotar en el guard de unidad. El caso no se
    // apoya en una segunda razon para fallar.
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: RAW },
      deps,
    );

    expect(r.status).toBe("forbidden");
    expect(r).toEqual({ status: "forbidden" });
    expect(consultarAgregado).not.toHaveBeenCalled();
  });

  it("y NO hay ni una metrica de la lista blanca que se cuele por la sesion", async () => {
    // El caso anterior con una sola metrica podria pasar por casualidad. Este recorre las DIEZ
    // que el canal por API key SI publica: son exactamente las que un fallo de canal dejaria
    // entrar por la puerta equivocada.
    for (const metricaId of METRICAS_API_KEY) {
      const { deps, consultar, consultarAgregado } = montar();

      const serie = await consultarAnaliticaOperativa({ metricaId, raw: RAW }, deps);
      const agregado = await consultarAgregadoOperativo({ metricaId, raw: RAW }, deps);

      expect(serie, `serie de ${metricaId}`).toEqual({ status: "forbidden" });
      expect(agregado, `agregado de ${metricaId}`).toEqual({ status: "forbidden" });
      expect(consultar).not.toHaveBeenCalled();
      expect(consultarAgregado).not.toHaveBeenCalled();
    }
  });

  it("el denegado SI se audita: el motivo vive en el log del servidor, no en la respuesta", async () => {
    const { deps, logError } = montar();

    await consultarAnaliticaOperativa({ metricaId: "entregas", raw: RAW }, deps);

    expect(logError).toHaveBeenCalledTimes(1);
    // Un intento por un canal que no corresponde es justo lo que hay que poder ver despues.
    expect(JSON.stringify(logError.mock.calls[0])).toContain("rol_sin_analitica");
  });
});
