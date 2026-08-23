import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleAnaliticaApiKey } from "@/app/api/ordenes/api-key/analitica/route";
import { consultarAnaliticaIntegrador } from "@/lib/api/analitica-integrador";
import type { AnaliticaApiKeyDeps } from "@/app/api/ordenes/api-key/analitica/route";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import type { SerieOperativa } from "@/lib/types/analitica-operativa";
import { METRICAS_API_KEY } from "@/lib/analytics/publicacion-api-key";

// Feature 267 (T7) — EL CASCARON HTTP, probado por donde duele.
//
// Lo que este archivo NO prueba, para que se sepa donde mirar: los cuatro pasos de la analitica
// (una sola llamada a `prepararConsultaAnalitica`, el logger en el denegado, la politica
// `seudonima`, el oraculo del mensajero) son de `analitica-integrador-borde.test.ts`, y la forma
// de la respuesta `200` es de `analitica-api-key-contrato.test.ts`. Aqui se prueba lo que solo
// puede fallar en el borde HTTP: el ORDEN de las puertas, que la query no sea una via para
// ampliar el alcance, y que dos preguntas distintas del integrador no le devuelvan dos respuestas
// distinguibles cuando la respuesta correcta es «no».
//
// El borde NO se mockea: se ejercita el camino real (route -> `consultarAnaliticaIntegrador` ->
// `resolverAlcance` -> filtro recortado) y lo unico inyectado es el autenticador, el servicio, el
// logger y el reloj. Un test que mockease el borde aprobaria un handler que le pasara la query
// entera, que es justo el fallo que R9/R27 persiguen.

/** El secreto en claro. Nunca debe aparecer en un cuerpo ni en un log (R33). */
const SECRETO = "ordx_secretovivo1234567890";

/** La cuenta dedicada 1:1 de la key: otro `usuario`, con su propio id. */
const ACTOR = { usuarioId: "u-integrador", rol: "apiKey" as const };

const OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SIN_KEY: ApiKeyAuthResult = { status: "unauthenticated" };
const INACTIVO: ApiKeyAuthResult = { status: "forbidden" };

/** Reloj congelado: ningun `new Date()` escondido decide el rango de una respuesta. */
const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** Una metrica de la lista blanca (`lib/analytics/publicacion-api-key.ts`). */
const PUBLICABLE = "entregas";
/** Existe en el catalogo y NO esta en la lista blanca (su exclusion esta motivada por escrito). */
const NO_PUBLICABLE = "sin_gestionar";
/** No existe en el catalogo, y punto. */
const INEXISTENTE = "metrica_que_no_existe_en_ningun_sitio";

/**
 * Servicio doble que ademas hace de CONTADOR DEL REPOSITORIO: el borde solo llega a la base a
 * traves de `consultar`, asi que cero llamadas aqui es cero llamadas alla. Devuelve una serie
 * que ECHA de vuelta el rango de la consulta preparada, para que el eco del cuerpo pueda
 * compararse con lo que se pidio (R24) en vez de contra una constante inventada.
 */
function servicioEspia() {
  const consultar = vi.fn(async (consulta: ConsultaAnalitica): Promise<SerieOperativa> => {
    return {
      metricaId: consulta.metrica.id,
      unidad: consulta.metrica.unidad,
      unidadDeConteo: consulta.metrica.unidadDeConteo,
      rango: consulta.rango,
      puntos: [{ fecha: consulta.rango.desdeFecha, valor: 7 }],
      cobertura: {
        fechasNoComparables: [],
        penumbra: "ordenes_vivas_al_horizonte_sin_transicion_posterior",
      },
    };
  });
  const service: IAnaliticaOperativaService = {
    consultar,
    async consultarAgregado(): Promise<never> {
      throw new Error("este canal sirve la SERIE, no el agregado");
    },
  };
  return { service, consultar };
}

function montar(auth: ApiKeyAuthResult = OK) {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const { service, consultar } = servicioEspia();
  const deps: AnaliticaApiKeyDeps = {
    autenticar: async () => auth,
    analitica: { service, logger, now: () => AHORA },
  };
  return { deps, consultar, logError };
}

const BASE = "http://localhost/api/ordenes/api-key/analitica";

/** Peticion con la key en el header, como la manda un integrador de verdad. */
function pedir(query: string, conKey = true): Request {
  return new Request(`${BASE}${query}`, {
    method: "GET",
    headers: conKey ? { Authorization: `Bearer ${SECRETO}` } : {},
  });
}

/** La query valida de referencia: una metrica publicable y una ventana de tres dias. */
const QUERY_OK = `?metricas=${PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`;

/** Espia de los cinco canales de `console` (por donde saldria un secreto sin querer). */
function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------------------------- */
/* R22 / R23 — el orden de las puertas                                                            */
/* -------------------------------------------------------------------------------------------- */

describe("267/R22 · la autenticacion resuelve ANTES de parsear la query", () => {
  it("sin Bearer: 401, y la query malformada NI SE MIRA (no hay 422)", async () => {
    const { deps, consultar } = montar(SIN_KEY);

    // La query es basura a proposito: sin `metrica`, con fechas imposibles y una clave ajena.
    const res = await handleAnaliticaApiKey(
      pedir("?desde=2026-13-45&hasta=nada&tienda_id=ajena", false),
      deps,
    );

    expect(res.status).toBe(401);
    expect(consultar).not.toHaveBeenCalled();
  });

  it("key inexistente: el MISMO 401 que sin key, byte a byte", async () => {
    const { deps } = montar(SIN_KEY);

    const sinKey = await handleAnaliticaApiKey(pedir(QUERY_OK, false), deps);
    const keyMuerta = await handleAnaliticaApiKey(pedir(QUERY_OK, true), deps);

    expect(sinKey.status).toBe(401);
    expect(keyMuerta.status).toBe(401);
    // Indistinguibles: si difirieran, un tercero podria averiguar si una key existe.
    expect(await keyMuerta.text()).toBe(await sinKey.text());
  });
});

describe("267/R23 · usuario dedicado inactivo: 403, y tambien antes de cualquier 422", () => {
  it("con la query valida: 403 y cero llamadas al servicio", async () => {
    const { deps, consultar } = montar(INACTIVO);

    const res = await handleAnaliticaApiKey(pedir(QUERY_OK), deps);

    expect(res.status).toBe(403);
    expect(consultar).not.toHaveBeenCalled();
  });

  it("con la query INVALIDA: sigue siendo 403, no 422 (la precedencia es del auth)", async () => {
    const { deps } = montar(INACTIVO);

    // Sin este caso, un handler que parsease primero devolveria 422 y le confirmaria al
    // portador de una key desactivada que su peticion llego a la capa de validacion.
    const res = await handleAnaliticaApiKey(pedir("?metricas=&desde=x&hasta=y"), deps);

    expect(res.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R24 / R25 / R26 — la ventana temporal                                                          */
/* -------------------------------------------------------------------------------------------- */

describe("267/R24 · `desde`/`hasta` son `YYYY-MM-DD` CR y `hasta` es INCLUSIVO", () => {
  it("los dos son obligatorios: falta uno => 422 en su propio campo (decision P3)", async () => {
    const { deps, consultar } = montar();

    const sinHasta = await handleAnaliticaApiKey(pedir(`?metricas=${PUBLICABLE}&desde=2026-08-01`), deps);
    const sinDesde = await handleAnaliticaApiKey(pedir(`?metricas=${PUBLICABLE}&hasta=2026-08-01`), deps);

    expect(sinHasta.status).toBe(422);
    expect(sinDesde.status).toBe(422);
    expect((await sinHasta.json()).details.fieldErrors).toHaveProperty("hasta");
    expect((await sinDesde.json()).details.fieldErrors).toHaveProperty("desde");
    expect(consultar).not.toHaveBeenCalled();
  });

  it("con reloj fijo, la consulta preparada cubre AMBOS extremos y el cuerpo los repite", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(pedir(QUERY_OK), deps);

    expect(res.status).toBe(200);
    const consulta = consultar.mock.calls[0]![0];
    // Inclusivo por los dos lados: el ultimo dia pedido ES el ultimo dia servido.
    expect(consulta.rango.desdeFecha).toBe("2026-08-01");
    expect(consulta.rango.hastaFecha).toBe("2026-08-03");
    expect(consulta.rango.preset).toBe("personalizado");
    // Y el eco del cuerpo habla el mismo idioma que la entrada, no el interno.
    const cuerpo = await res.json();
    expect(cuerpo.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-03" });
    // P4-bis: una sola metrica ya viaja dentro del sobre, con la misma forma que diez.
    expect(cuerpo.metricas.map((m: { metrica: string }) => m.metrica)).toEqual([PUBLICABLE]);
  });

  it("una fecha que el calendario no tiene (`2026-02-31`) es 422, no un dia rodado en silencio", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE}&desde=2026-02-31&hasta=2026-03-05`),
      deps,
    );

    expect(res.status).toBe(422);
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("267/R25 · `desde` posterior a `hasta` es 422 en `fieldErrors.hasta`, nunca 200 vacio", () => {
  it("rango invertido => 422 con el error bajo `hasta` y sin tocar el servicio", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE}&desde=2026-08-10&hasta=2026-08-01`),
      deps,
    );

    expect(res.status).toBe(422);
    const cuerpo = await res.json();
    expect(Object.keys(cuerpo.details.fieldErrors)).toContain("hasta");
    // Un 200 con serie vacia aqui se leeria como «no pasó nada esos días», que es falso.
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("267/R26 · el tope de ventana", () => {
  it("366 dias contando ambos extremos: pasa (es el tope, no lo supera)", async () => {
    const { deps } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE}&desde=2025-08-01&hasta=2026-08-01`),
      deps,
    );

    expect(res.status).toBe(200);
  });

  it("367 dias: 422", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE}&desde=2025-08-01&hasta=2026-08-02`),
      deps,
    );

    expect(res.status).toBe(422);
    expect(consultar).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R9 / R27 — la query no es una via para elegir de quien son los datos                           */
/* -------------------------------------------------------------------------------------------- */

describe("267/R9 + R27 · claves no declaradas no cambian NI la respuesta NI el filtro", () => {
  const RUIDO = "&tienda_id=otra-tienda&zona_id=z-1&mensajero_id=m-1&sortBy=valor&limit=9999";

  it("con y sin ruido, el cuerpo es identico byte a byte", async () => {
    const limpio = montar();
    const sucio = montar();

    const a = await handleAnaliticaApiKey(pedir(QUERY_OK), limpio.deps);
    const b = await handleAnaliticaApiKey(pedir(`${QUERY_OK}${RUIDO}`), sucio.deps);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await b.text()).toBe(await a.text());
  });

  it("y el filtro que LLEGA AL SERVICIO es el mismo, recortado a la tienda del actor", async () => {
    const limpio = montar();
    const sucio = montar();

    await handleAnaliticaApiKey(pedir(QUERY_OK), limpio.deps);
    await handleAnaliticaApiKey(pedir(`${QUERY_OK}${RUIDO}`), sucio.deps);

    const filtroLimpio = limpio.consultar.mock.calls[0]![0].filtro;
    const filtroSucio = sucio.consultar.mock.calls[0]![0].filtro;

    expect(filtroSucio).toEqual(filtroLimpio);
    // El sujeto del recorte sale del ACTOR, jamas de la peticion.
    expect(filtroSucio.tienda_id).toEqual([ACTOR.usuarioId]);
    expect(filtroSucio.zona_id).toBeUndefined();
    expect(filtroSucio.mensajero_id).toBeUndefined();
    // Y las dos unicas cosas que el integrador elige son las fechas.
    expect(filtroSucio.desde).toBe("2026-08-01");
    expect(filtroSucio.hasta).toBe("2026-08-03");
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R16 — no se puede sondear la lista blanca desde fuera                                          */
/* -------------------------------------------------------------------------------------------- */

describe("267/R16 · «existe pero no es tuya» y «no existe» son la MISMA respuesta", () => {
  it("metrica no publicable y metrica inexistente: mismo status y mismo cuerpo", async () => {
    const noPublicable = montar();
    const inexistente = montar();

    const a = await handleAnaliticaApiKey(
      pedir(`?metricas=${NO_PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`),
      noPublicable.deps,
    );
    const b = await handleAnaliticaApiKey(
      pedir(`?metricas=${INEXISTENTE}&desde=2026-08-01&hasta=2026-08-03`),
      inexistente.deps,
    );

    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    // Si estos dos cuerpos difirieran —aunque fuera en una palabra del mensaje—, el enum
    // publicable se podria RECONSTRUIR desde fuera probando ids uno a uno.
    expect(await b.text()).toBe(await a.text());
    expect(a.headers.get("content-type")).toBe(b.headers.get("content-type"));
    // Ninguna de las dos llega a la base.
    expect(noPublicable.consultar).not.toHaveBeenCalled();
    expect(inexistente.consultar).not.toHaveBeenCalled();
  });

  it("y las dos SI se auditan por dentro, que es donde el motivo puede vivir", async () => {
    const noPublicable = montar();
    const inexistente = montar();

    await handleAnaliticaApiKey(
      pedir(`?metricas=${NO_PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`),
      noPublicable.deps,
    );
    await handleAnaliticaApiKey(
      pedir(`?metricas=${INEXISTENTE}&desde=2026-08-01&hasta=2026-08-03`),
      inexistente.deps,
    );

    expect(noPublicable.logError).toHaveBeenCalledTimes(1);
    expect(inexistente.logError).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R10 — pedir datos de otra tienda es 403, nunca 200 vacio                                       */
/* -------------------------------------------------------------------------------------------- */

describe("267/R10 · datos de otra tienda", () => {
  it("por la query no hay forma de pedirlos: `tienda_id` ajeno se queda fuera y responde 200 con LO PROPIO", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`${QUERY_OK}&tienda_id=tienda-de-otro`),
      deps,
    );

    expect(res.status).toBe(200);
    // La clave ajena no viaja: el filtro nombra al actor y a nadie mas.
    expect(consultar.mock.calls[0]![0].filtro.tienda_id).toEqual([ACTOR.usuarioId]);
  });

  it("y si alguien la colara en el filtro interno, la interseccion vacia es 403 y NO 200 vacio", async () => {
    // Defensa en profundidad: el cascaron nunca escribe `tienda_id`, asi que este camino no
    // esta vivo hoy. Se prueba igual porque la garantia que R10 pide es del RECORTE, no de que
    // nadie se equivoque nunca al construir el filtro.
    const { service, consultar } = servicioEspia();
    const logError = vi.fn();

    const salida = await consultarAnaliticaIntegrador(
      {
        actor: ACTOR,
        metricaIds: [PUBLICABLE],
        raw: {
          rango: "personalizado",
          desde: "2026-08-01",
          hasta: "2026-08-03",
          tienda_id: ["tienda-de-otro"],
        },
      },
      { service, logger: { logError }, now: () => AHORA },
    );

    expect(salida.status).toBe("forbidden");
    expect(consultar).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R33 — el secreto no sale por ningun canal                                                      */
/* -------------------------------------------------------------------------------------------- */

describe("267/R33 · ni la key ni el header `Authorization` aparecen en el log ni en el cuerpo", () => {
  it("en los cuatro desenlaces (200, 403 denegado, 422 y 403 de auth) el secreto no aparece", async () => {
    const spies = spyConsole();
    const ok = montar();
    const denegado = montar();
    const invalido = montar();
    const inactivo = montar(INACTIVO);

    const respuestas = [
      await handleAnaliticaApiKey(pedir(QUERY_OK), ok.deps),
      await handleAnaliticaApiKey(
        pedir(`?metricas=${NO_PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`),
        denegado.deps,
      ),
      await handleAnaliticaApiKey(
        pedir(`?metricas=${PUBLICABLE}&desde=2026-08-10&hasta=2026-08-01`),
        invalido.deps,
      ),
      await handleAnaliticaApiKey(pedir(QUERY_OK), inactivo.deps),
    ];

    for (const res of respuestas) {
      const texto = await res.text();
      expect(texto).not.toContain(SECRETO);
      expect(texto.toLowerCase()).not.toContain("authorization");
    }

    // El logger de auditoria recibe el motivo del denegado, y NADA del portador.
    for (const { logError } of [ok, denegado, invalido, inactivo]) {
      for (const call of logError.mock.calls) {
        const serializado = JSON.stringify(call, (_k, v) => (v instanceof Error ? v.message : v));
        expect(serializado).not.toContain(SECRETO);
        expect(serializado.toLowerCase()).not.toContain("authorization");
      }
    }

    // Y tampoco se escapa por `console.*`, que es el otro sitio donde acaban los secretos.
    for (const spy of Object.values(spies)) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRETO);
      }
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
/* P4-bis — `metricas` COMO LISTA (R45, R46, R47)                                                 */
/* -------------------------------------------------------------------------------------------- */

describe("267/R45 · el lote: varias metricas en una sola llamada", () => {
  it("tres ids separados por coma: 200 con las tres series, EN EL ORDEN PEDIDO", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir("?metricas=tasa_entrega,entregas,devoluciones&desde=2026-08-01&hasta=2026-08-03"),
      deps,
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.metricas.map((m: { metrica: string }) => m.metrica)).toEqual([
      "tasa_entrega",
      "entregas",
      "devoluciones",
    ]);
    // El rango se publica UNA vez, en la raiz, y no dentro de cada serie (R48).
    expect(cuerpo.rango).toEqual({ desde: "2026-08-01", hasta: "2026-08-03" });
    for (const serie of cuerpo.metricas) expect(serie).not.toHaveProperty("rango");
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it("los espacios alrededor de los ids no cambian nada: `a, b` es `a,b`", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir("?metricas=entregas,%20devoluciones&desde=2026-08-01&hasta=2026-08-03"),
      deps,
    );

    expect(res.status).toBe(200);
    expect(consultar.mock.calls.map((c) => c[0].metrica.id)).toEqual([
      "entregas",
      "devoluciones",
    ]);
  });

  it("R47 — un id repetido se sirve UNA vez, conservando su primera posicion", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir("?metricas=entregas,devoluciones,entregas&desde=2026-08-01&hasta=2026-08-03"),
      deps,
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.metricas.map((m: { metrica: string }) => m.metrica)).toEqual([
      "entregas",
      "devoluciones",
    ]);
    // Y el rollup no paga dos veces por la misma cifra.
    expect(consultar).toHaveBeenCalledTimes(2);
  });
});

describe("267/R46 · `all` trae TODA la lista blanca, y no se mezcla con ids", () => {
  it("`metricas=all` sirve exactamente `METRICAS_API_KEY`, en el orden de la lista", async () => {
    // Se compara contra la FUENTE, no contra una lista repetida aqui: si manana se da de alta
    // una metrica publicable, `all` tiene que traerla sin que nadie toque este test.
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir("?metricas=all&desde=2026-08-01&hasta=2026-08-03"),
      deps,
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.metricas.map((m: { metrica: string }) => m.metrica)).toEqual([
      ...METRICAS_API_KEY,
    ]);
    expect(consultar).toHaveBeenCalledTimes(METRICAS_API_KEY.length);
  });

  it("`all` mezclado con un id es 422 en `metricas`: un contrato publico no adivina", async () => {
    const { deps, consultar } = montar();

    const res = await handleAnaliticaApiKey(
      pedir("?metricas=all,entregas&desde=2026-08-01&hasta=2026-08-03"),
      deps,
    );

    expect(res.status).toBe(422);
    expect((await res.json()).details.fieldErrors).toHaveProperty("metricas");
    expect(consultar).not.toHaveBeenCalled();
  });

  it("un elemento vacio (`a,,b`, `metricas=`) es 422, no un lote a medias", async () => {
    const vacioEnMedio = montar();
    const claveVacia = montar();

    const a = await handleAnaliticaApiKey(
      pedir("?metricas=entregas,,devoluciones&desde=2026-08-01&hasta=2026-08-03"),
      vacioEnMedio.deps,
    );
    const b = await handleAnaliticaApiKey(
      pedir("?metricas=&desde=2026-08-01&hasta=2026-08-03"),
      claveVacia.deps,
    );

    expect(a.status).toBe(422);
    expect(b.status).toBe(422);
    expect(vacioEnMedio.consultar).not.toHaveBeenCalled();
    expect(claveVacia.consultar).not.toHaveBeenCalled();
  });

  it("mas ids que metricas publicables es 422 y NO llega a preparar consultas", async () => {
    // Tras deduplicar nunca puede haber mas ids validos que metricas publicables, asi que una
    // lista mas larga contiene necesariamente algo que no se publica. Se corta antes de preparar
    // cien consultas para denegar despues.
    const { deps, consultar } = montar();
    const demasiados = Array.from({ length: METRICAS_API_KEY.length + 1 }, (_, i) => `m${i}`);

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${demasiados.join(",")}&desde=2026-08-01&hasta=2026-08-03`),
      deps,
    );

    expect(res.status).toBe(422);
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("267/R16 + R45 · un lote con UNA metrica no publicable no sirve NADA", () => {
  it("`entregas,sin_gestionar` es 403 mudo y CERO consultas, tambien para la publicable", async () => {
    // El exito parcial seria el peor de los mundos: la respuesta diria por omision cuales ids
    // estan en la lista blanca, y bastaria UNA peticion para reconstruirla entera. Por eso el
    // lote es todo o nada.
    const { deps, consultar, logError } = montar();

    const res = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE},${NO_PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`),
      deps,
    );

    expect(res.status).toBe(403);
    expect(consultar).not.toHaveBeenCalled();
    // Por dentro SI queda el rastro, con el id culpable: es donde el motivo puede vivir.
    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0]![0] as Record<string, unknown>).metricaId).toBe(NO_PUBLICABLE);
  });

  it("y ese 403 es identico byte a byte al de un lote con un id inexistente", async () => {
    const noPublicable = montar();
    const inexistente = montar();

    const a = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE},${NO_PUBLICABLE}&desde=2026-08-01&hasta=2026-08-03`),
      noPublicable.deps,
    );
    const b = await handleAnaliticaApiKey(
      pedir(`?metricas=${PUBLICABLE},${INEXISTENTE}&desde=2026-08-01&hasta=2026-08-03`),
      inexistente.deps,
    );

    expect(a.status).toBe(403);
    expect(await b.text()).toBe(await a.text());
  });
});
