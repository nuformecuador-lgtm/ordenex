import { describe, it, expect, vi, beforeEach } from "vitest";
import * as consultas from "@/lib/analytics/consulta";
import { consultarAnaliticaIntegrador } from "@/lib/api/analitica-integrador";
import type { AnaliticaIntegradorDeps } from "@/lib/api/analitica-integrador";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import type { SerieOperativa } from "@/lib/types/analitica-operativa";

// Feature 267 (T5) — EL BORDE DEL CANAL INTEGRADOR, probado por donde duele.
//
// ⚠ R32 ESPIA EL LOGGER, NO EL STATUS, y el motivo esta verificado en el codigo (design §4.4):
// `normalizeError` devuelve la shape del `AppError` en su PRIMERA linea
// (`lib/errors/normalize.ts:22`) y solo llama a `logger.logError` en la rama del error
// DESCONOCIDO (`:45`). Un borde que lanzara `ForbiddenError` y confiara en `withErrorHandler`
// responderia 403 correctamente y NO dejaria rastro ninguno: el 403 MUDO. Un test que solo
// mirase el status aprobaria a los dos, y un canal publico sin rastro del intento denegado es
// justo lo que no puede pasar.
//
// R14 se prueba CONTANDO las llamadas a `prepararConsultaAnalitica`: la garantia de la 122 es
// que hay UN punto de entrada, y dos llamadas —aunque las dos concedieran— significarian que
// alguien resolvio el alcance dos veces y podria quedarse con la respuesta equivocada.

vi.mock("@/lib/analytics/consulta", async (importOriginal) => {
  const original = await importOriginal<typeof consultas>();
  return {
    ...original,
    prepararConsultaAnalitica: vi.fn(original.prepararConsultaAnalitica),
  };
});

const prepararEspia = vi.mocked(consultas.prepararConsultaAnalitica);

/** Reloj congelado. Un lunes cualquiera, 15:00 UTC = 09:00 CR. */
const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** La cuenta dedicada 1:1 de la API key: otro `usuario`, con su propio id. */
const INTEGRADOR: ActorAnalitica = { usuarioId: "u-integrador", rol: "apiKey" };

const SERIE_VACIA: SerieOperativa = {
  metricaId: "entregas",
  unidad: "conteo",
  unidadDeConteo: "gestion",
  rango: {
    preset: "personalizado",
    desde: AHORA,
    hasta: AHORA,
    desdeFecha: "2026-08-03",
    hastaFecha: "2026-08-03",
  },
  puntos: [],
  cobertura: {
    fechasNoComparables: [],
    penumbra: "ordenes_vivas_al_horizonte_sin_transicion_posterior",
  },
};

/**
 * Doble del servicio que ademas hace de CONTADOR DEL REPOSITORIO: como el borde solo llega a
 * la base a traves de `consultar`, cero llamadas aqui es cero llamadas alla. Si el borde
 * pidiera el agregado, este doble lo dice a gritos en vez de devolver algo plausible.
 */
function servicioEspia() {
  const consultar = vi.fn(async (_consulta: ConsultaAnalitica): Promise<SerieOperativa> => {
    void _consulta;
    return SERIE_VACIA;
  });
  const service: IAnaliticaOperativaService = {
    consultar,
    async consultarAgregado(): Promise<never> {
      throw new Error("este borde sirve la SERIE, no el agregado");
    },
  };
  return { service, consultar };
}

function montar() {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const { service, consultar } = servicioEspia();
  const deps: AnaliticaIntegradorDeps = { service, logger, now: () => AHORA };
  return { logError, consultar, deps };
}

/** El filtro que construye el cascaron a partir de `desde`/`hasta` (design §4.2). */
function raw(extra: Record<string, unknown> = {}) {
  return { rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-03", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("267/R14 · una sola llamada al punto de entrada, con el canal explicito", () => {
  it("`prepararConsultaAnalitica` se llama EXACTAMENTE una vez", async () => {
    const { deps } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(r.status).toBe("ok");
    expect(prepararEspia).toHaveBeenCalledTimes(1);
  });

  it("el quinto argumento es `api_key`: sin el, el default `interno` denegaria (267/R6)", async () => {
    const { deps } = montar();

    await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    const [rawPasado, actorPasado, metricaPasada, nowPasado, canalPasado] =
      prepararEspia.mock.calls[0]!;
    expect(canalPasado).toBe("api_key");
    expect(actorPasado).toEqual(INTEGRADOR);
    expect(metricaPasada).toBe("entregas");
    expect(nowPasado).toEqual(AHORA);
    expect(rawPasado).toEqual(raw());
  });

  it("el mismo borde con el canal por defecto denegaria: la prueba de que el 5.º arg importa", () => {
    // No se llama al borde: se comprueba la propiedad de la que depende, sobre el mismo
    // actor y la misma metrica. Si `prepararConsultaAnalitica` se invocara sin `"api_key"`,
    // este es el resultado que recibiria el integrador.
    const sinCanal = consultas.prepararConsultaAnalitica(raw(), INTEGRADOR, "entregas", AHORA);
    expect(sinCanal.status).toBe("forbidden");
  });
});

describe("267/R35 · la consulta de este canal viaja SIEMPRE con politica seudonima", () => {
  it("la consulta que recibe el servicio lleva politicaIdentidad seudonima", async () => {
    const { deps, consultar } = montar();

    await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(consultar).toHaveBeenCalledTimes(1);
    const consulta = consultar.mock.calls[0]![0];
    expect(consulta.politicaIdentidad).toBe("seudonima");
  });

  it("y con el recorte a SU propia tienda: la politica no sustituye al alcance", async () => {
    const { deps, consultar } = montar();

    await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    const consulta = consultar.mock.calls[0]![0];
    expect(consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "u-integrador" });
    expect(consulta.filtro.tienda_id).toEqual(["u-integrador"]);
  });

  it("el borde no ofrece desagregacion: el servicio se llama con UN solo argumento (P2)", async () => {
    const { deps, consultar } = montar();

    await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(consultar.mock.calls[0]!.length).toBe(1);
  });
});

describe("267/R32 · el denegado deja rastro ANTES de responder, y responde mudo", () => {
  it("una metrica que existe pero NO es publicable: forbidden + logger llamado", async () => {
    // `egresos` es del dominio financiero: existe en el catalogo y jamas entra en la lista
    // blanca (R17).
    const { deps, logError, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "egresos", raw: raw() },
      deps,
    );

    expect(r.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0]![0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("metrica_prohibida");
    expect(registro.rol).toBe("apiKey");
    expect(registro.usuarioId).toBe("u-integrador");
    expect(consultar).not.toHaveBeenCalled();
  });

  it("una metrica inexistente tambien audita, y el cuerpo del denegado es el MISMO", async () => {
    const { deps, logError, consultar } = montar();

    const inexistente = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "metrica-que-no-existe", raw: raw() },
      deps,
    );

    expect(inexistente).toEqual({ status: "forbidden" });
    // Sin motivo hacia fuera: el motivo (aqui `metrica_desconocida`) va SOLO al log, para que
    // el integrador no pueda distinguir «existe pero no es tuya» de «no existe» (R16).
    expect(Object.keys(inexistente)).toEqual(["status"]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0]![0] as Record<string, unknown>).motivo).toBe(
      "metrica_desconocida",
    );
    expect(consultar).not.toHaveBeenCalled();
  });

  it("un actor sin `usuarioId` util se deniega y NO toca el repositorio (267/R11)", async () => {
    const { deps, logError, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: { usuarioId: "", rol: "apiKey" }, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(r.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0]![0] as Record<string, unknown>).motivo).toBe("sin_sesion");
    expect(consultar).not.toHaveBeenCalled();
  });

  it("pedir la tienda de otro es forbidden auditado, nunca 200 con serie vacia (267/R10)", async () => {
    const { deps, logError, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw({ tienda_id: ["tienda-ajena"] }) },
      deps,
    );

    expect(r.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0]![0] as Record<string, unknown>;
    expect(registro.motivo).toBe("filtro_fuera_de_alcance");
    expect(registro.alcancePedido).toEqual({ tiendaId: "tienda-ajena" });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("una entrada invalida devuelve validation_error, NO audita y NO consulta", async () => {
    const { deps, logError, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: { rango: "personalizado" } },
      deps,
    );

    expect(r.status).toBe("validation_error");
    // No hay denegado que registrar: un filtro malformado no puede servir para sondear el
    // catalogo ni los permisos de nadie, y por eso tampoco revela el motivo.
    expect(logError).not.toHaveBeenCalled();
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("267/R37 · el oraculo de identidad tambien vigila este canal", () => {
  it("un filtro con `mensajero_id` es 403 AUDITADO, aunque la metrica sea publicable", async () => {
    const { deps, logError, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      {
        actor: INTEGRADOR,
        metricaId: "entregas",
        raw: raw({ mensajero_id: ["11111111-1111-4111-8111-111111111111"] }),
      },
      deps,
    );

    expect(r.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0]![0] as Record<string, unknown>;
    expect(registro.motivo).toBe("filtro_fuera_de_alcance");
    expect(registro.filtroRechazado).toEqual({
      mensajero_id: ["11111111-1111-4111-8111-111111111111"],
    });
    // R37 + P2: la dimension `mensajero` esta prohibida ENTERA en este canal. Cero llamadas.
    expect(consultar).not.toHaveBeenCalled();
  });

  it("el predicado es el compartido: sin `mensajero_id` la misma consulta pasa", async () => {
    const { deps, consultar } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(r.status).toBe("ok");
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});

describe("267 · el camino concedido devuelve la serie del servicio, sin tocarla", () => {
  it("`ok` lleva los datos tal cual los produjo el servicio", async () => {
    const { deps } = montar();

    const r = await consultarAnaliticaIntegrador(
      { actor: INTEGRADOR, metricaId: "entregas", raw: raw() },
      deps,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.datos).toBe(SERIE_VACIA);
  });
});
