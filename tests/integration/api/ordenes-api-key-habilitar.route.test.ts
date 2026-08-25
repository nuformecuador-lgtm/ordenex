import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  handleHabilitarApi,
  POST,
  type HabilitarApiDeps,
} from "@/app/api/ordenes/api-key/habilitar/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  HabilitacionLoteResult,
  IApiHabilitacionService,
} from "@/lib/interfaces/services/IApiHabilitacionService";
import { TOPE_FILAS_HABILITAR } from "@/lib/config/habilitacion-api";

// Feature 266 (T5.2) — el borde de `POST /api/ordenes/api-key/habilitar`, con `deps` inyectadas y
// sin DB (patron de `ordenes-api-key-cancelar.route.test.ts`). Lo que se afirma aqui es SOLO lo del
// borde: auth, envoltorio del cuerpo, codigo HTTP y que la key no se filtra. El comportamiento por
// fila es del service y vive en `tests/unit/services/api-habilitacion-service.test.ts`.

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

const LOTE_OK: HabilitacionLoteResult = {
  resumen: { total: 2, habilitadas: 1, habilitadasSinCambioDeEstado: 0, conError: 1 },
  resultados: [
    { numGuia: 100234, resultado: "habilitada", estado: "en_reparto", error: null },
    {
      numGuia: 999999,
      resultado: "error",
      estado: null,
      error: { codigo: "no_encontrada", mensaje: "no existe una orden viva con esa guia" },
    },
  ],
};

function fakeService(result: HabilitacionLoteResult = LOTE_OK) {
  const habilitarLote = vi.fn(async () => result);
  const service: IApiHabilitacionService = { habilitarLote };
  return { service, habilitarLote };
}

function deps(auth: ApiKeyAuthResult, service: IApiHabilitacionService): HabilitarApiDeps {
  return { autenticar: async () => auth, habilitacionService: service };
}

const AUTH_OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

/** Peticion con cuerpo JSON ya serializado (o crudo, para el caso de JSON invalido). */
function req(bearer: string | undefined, body: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/habilitar", {
    method: "POST",
    headers,
    body,
  });
}

function lote(n: number): string {
  const ordenes = Array.from({ length: n }, (_, i) => ({ num_guia: 100000 + i, nota: "reintento" }));
  return JSON.stringify({ ordenes });
}

const CUERPO_VALIDO = lote(2);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("266/R1-R2 — sin key valida no se toca ninguna orden", () => {
  it("sin cabecera Authorization responde 401 y el service no llega a llamarse", async () => {
    const { service, habilitarLote } = fakeService();
    const res = await handleHabilitarApi(
      req(undefined, CUERPO_VALIDO),
      deps({ status: "unauthenticated" }, service),
    );
    expect(res.status).toBe(401);
    expect(habilitarLote).not.toHaveBeenCalled(); // R1: ni lectura, ni escritura, ni registro
  });

  it("una key que autentica pero no esta habilitada para el canal responde 403 sin procesar el lote", async () => {
    const { service, habilitarLote } = fakeService();
    const res = await handleHabilitarApi(
      req(SECRETO, CUERPO_VALIDO),
      deps({ status: "forbidden" }, service),
    );
    expect(res.status).toBe(403);
    expect(habilitarLote).not.toHaveBeenCalled(); // R2
  });
});

describe("266/R6 y D2 — el envoltorio del cuerpo es lo unico que produce un 422 global", () => {
  it.each([
    ["cuerpo que no es JSON", "esto no es json"],
    ["sin la clave `ordenes`", JSON.stringify({ filas: [] })],
    ["`ordenes` que no es un array", JSON.stringify({ ordenes: { num_guia: 1 } })],
    ["array vacio", JSON.stringify({ ordenes: [] })],
    ["un elemento que no es un objeto", JSON.stringify({ ordenes: [123] })],
    ["un elemento nulo", JSON.stringify({ ordenes: [null] })],
  ])("%s -> 422 y el service no se llama", async (_caso, cuerpo) => {
    const { service, habilitarLote } = fakeService();
    const res = await handleHabilitarApi(req(SECRETO, cuerpo), deps(AUTH_OK, service));
    expect(res.status).toBe(422);
    expect(habilitarLote).not.toHaveBeenCalled();
  });

  it(`un lote de ${TOPE_FILAS_HABILITAR + 1} filas excede el tope: 422 sin procesar ninguna fila`, async () => {
    const { service, habilitarLote } = fakeService();
    const res = await handleHabilitarApi(
      req(SECRETO, lote(TOPE_FILAS_HABILITAR + 1)),
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(422);
    expect(habilitarLote).not.toHaveBeenCalled();
  });

  it(`un lote de exactamente ${TOPE_FILAS_HABILITAR} filas SI pasa el envoltorio (D2: el tope es inclusivo)`, async () => {
    const { service, habilitarLote } = fakeService({
      resumen: {
        total: TOPE_FILAS_HABILITAR,
        habilitadas: TOPE_FILAS_HABILITAR,
        habilitadasSinCambioDeEstado: 0,
        conError: 0,
      },
      resultados: [],
    });
    const res = await handleHabilitarApi(
      req(SECRETO, lote(TOPE_FILAS_HABILITAR)),
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(200);
    expect(habilitarLote).toHaveBeenCalledTimes(1);
    const [, filas] = habilitarLote.mock.calls[0] as unknown as [Actor, unknown[]];
    expect(filas).toHaveLength(TOPE_FILAS_HABILITAR);
  });

  it("una fila con los CAMPOS mal (R7) NO es un 422: el borde la pasa al service", async () => {
    // La division de la validacion en dos niveles, afirmada donde importa: si este borde mirara
    // `num_guia`/`nota`, una fila mala tiraria el lote entero, que es justo lo que R7 prohibe.
    const { service, habilitarLote } = fakeService();
    const cuerpo = JSON.stringify({ ordenes: [{ num_guia: "no-entero", nota: "" }] });
    const res = await handleHabilitarApi(req(SECRETO, cuerpo), deps(AUTH_OK, service));
    expect(res.status).toBe(200);
    expect(habilitarLote).toHaveBeenCalledWith(ACTOR, [{ num_guia: "no-entero", nota: "" }]);
  });
});

describe("266/R9-R10 — 200 con un resultado por fila, y el estado poblado en los exitos", () => {
  it("un lote con una fila OK y una fila en error responde 200 con los dos resultados", async () => {
    const { service } = fakeService();
    const res = await handleHabilitarApi(req(SECRETO, CUERPO_VALIDO), deps(AUTH_OK, service));
    expect(res.status).toBe(200); // R9: el fallo de una fila no es un error global
    const json = await res.json();
    expect(json.resultados).toHaveLength(2);
    expect(json.resumen).toEqual({
      total: 2,
      habilitadas: 1,
      habilitadasSinCambioDeEstado: 0,
      conError: 1,
    });
  });

  it("cada fila trae un `resultado` del conjunto cerrado y `estado` poblado si no es error", async () => {
    const { service } = fakeService({
      resumen: { total: 3, habilitadas: 1, habilitadasSinCambioDeEstado: 1, conError: 1 },
      resultados: [
        { numGuia: 1, resultado: "habilitada", estado: "en_reparto", error: null },
        { numGuia: 2, resultado: "habilitada_sin_cambio_de_estado", estado: "devuelta", error: null },
        {
          numGuia: 3,
          resultado: "error",
          estado: null,
          error: { codigo: "estado_no_habilitable", mensaje: "no habilitable" },
        },
      ],
    });
    const res = await handleHabilitarApi(req(SECRETO, CUERPO_VALIDO), deps(AUTH_OK, service));
    const json = await res.json();
    for (const fila of json.resultados) {
      expect(["habilitada", "habilitada_sin_cambio_de_estado", "error"]).toContain(fila.resultado);
      if (fila.resultado === "error") expect(fila.estado).toBeNull();
      else expect(typeof fila.estado).toBe("string");
    }
  });

  it("el service recibe el actor de la key y las filas en el mismo orden que llegaron", async () => {
    const { service, habilitarLote } = fakeService();
    await handleHabilitarApi(
      req(SECRETO, JSON.stringify({ ordenes: [{ num_guia: 11, nota: "a" }, { num_guia: 22, nota: "b" }] })),
      deps(AUTH_OK, service),
    );
    expect(habilitarLote).toHaveBeenCalledWith(ACTOR, [
      { num_guia: 11, nota: "a" },
      { num_guia: 22, nota: "b" },
    ]);
  });
});

describe("266/R5 — la API key no aparece en ninguna respuesta ni en ningun log", () => {
  it.each([
    ["401", { status: "unauthenticated" } as ApiKeyAuthResult],
    ["403", { status: "forbidden" } as ApiKeyAuthResult],
    ["200", AUTH_OK],
  ])("en la respuesta %s ni el cuerpo ni `console.error` contienen la key", async (_caso, auth) => {
    // El espia es REAL, no una inspeccion visual: si alguien mete la key en un log, este test cae.
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const { service } = fakeService();
    const res = await handleHabilitarApi(req(SECRETO, CUERPO_VALIDO), deps(auth, service));
    const texto = await res.text();
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain("ordx_");
    for (const llamada of espia.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain(SECRETO);
    }
  });

  it("un error inesperado del service tampoco arrastra la key al log ni al cuerpo", async () => {
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const habilitarLote = vi.fn(async () => {
      throw new Error("boom");
    });
    const res = await handleHabilitarApi(req(SECRETO, CUERPO_VALIDO), {
      autenticar: async () => AUTH_OK,
      habilitacionService: { habilitarLote } as unknown as IApiHabilitacionService,
    });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRETO);
    for (const llamada of espia.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain(SECRETO);
    }
  });
});

describe("266 — el modulo publica POST y la ruta sigue cubierta por el middleware sin tocarlo", () => {
  it("expone POST y no otro verbo", async () => {
    const mod = await import("@/app/api/ordenes/api-key/habilitar/route");
    expect(typeof POST).toBe("function");
    expect((mod as Record<string, unknown>).PUT).toBeUndefined();
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
    expect(mod.runtime).toBe("nodejs");
  });

  it("el middleware ya cubria el prefijo del canal, asi que la ruta nueva no lo modifica", async () => {
    // La guardia 229 congela las TRES listas del middleware posicionalmente contra una lista
    // firmada: anadir aqui la ruta la pondria roja sin necesidad. Se afirma que NO hizo falta.
    const texto = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
    expect(texto).toContain('SELF_AUTH_ROUTES = ["/api/cron", "/api/ordenes/api-key"');
    expect(texto).not.toContain("/api/ordenes/api-key/habilitar");
  });
});
