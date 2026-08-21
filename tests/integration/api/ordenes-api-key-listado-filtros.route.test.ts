// Feature 257 (T8) — Filtros nuevos del LISTADO por API key: `desde`, `hasta`, `num_guia` y
// `num_remision`. Este archivo prueba el BORDE HTTP (`handleListadoApi`) con inyeccion de
// dependencias: sin DB, sin cookies, con un `lecturaService` falso. Cubre R1, R2, R3, R4, R10,
// R11, R12, R13, R14, R16, R17 y R19.
//
// Que congela, en concreto:
//   - Que anadir cuatro parametros NO cambie la respuesta de una peticion que no los usa (R1) ni
//     abra la puerta a leer claves desconocidas de la query como `tiendaId`/`owner` (R2).
//   - Que la autenticacion siga ganando a la validacion: una query invalida sin Bearer es 401,
//     nunca 422, para no filtrar como valida el endpoint antes de saber quien pregunta (R3).
//   - Que una fecha malformada o imposible NO llegue a la base de datos. La forma observable de
//     "sin consultar la base de datos" es que el service no se llame.
//   - Que `desde > hasta` sea un 422 ruidoso y no una pagina vacia silenciosa (R12).
//   - Que el borde traduzca el `snake_case` publico al `camelCase` interno sin transformar los
//     valores (R13/R16), y que `fieldErrors` salga con la clave TAL CUAL llega en la query.
import { describe, it, expect, vi } from "vitest";
import { handleListadoApi, type ListadoApiDeps } from "@/app/api/ordenes/api-key/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type { ApiOrdenListadoDTO } from "@/lib/types/api-orden";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okListado(): ApiOrdenListadoDTO {
  return {
    items: [
      {
        numGuia: 10234,
        numRemision: "REM-1",
        estado: "en_bodega_central",
        destinatario: "Ana",
        telefonoDest: "099",
        producto: "Caja",
        direccion: "Calle 1",
        montoCobrar: 1500,
        createdAt: new Date("2026-07-20T15:04:00.000Z"),
      },
    ],
    pagination: { limit: 50, offset: 0, total: 173 },
  };
}

function paginaVacia(): ApiOrdenListadoDTO {
  return { items: [], pagination: { limit: 50, offset: 0, total: 0 } };
}

function fakeService(overrides: Partial<IApiOrdenLecturaService> = {}): IApiOrdenLecturaService {
  return {
    listar: vi.fn().mockResolvedValue(okListado()),
    detalle: vi.fn(),
    detallePorOrdenId: vi.fn(), // feature 177: metodo hermano, no usado por este endpoint
    ...overrides,
  };
}

function deps(
  auth: ApiKeyAuthResult,
  service: IApiOrdenLecturaService,
  spyAuth?: ListadoApiDeps["autenticar"],
): ListadoApiDeps {
  return { autenticar: spyAuth ?? (async () => auth), lecturaService: service };
}

function req(query = "", bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/api/ordenes/api-key${query}`, { method: "GET", headers });
}

const AUTH_OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

/** Params con que se llamo al service en su unica invocacion esperada. */
function paramsDeLaLlamada(service: IApiOrdenLecturaService): Record<string, unknown> {
  const mock = vi.mocked(service.listar);
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0][1] as unknown as Record<string, unknown>;
}

/** Cuerpo de error de la ruta: { status, code, message, details: { fieldErrors } }. */
async function errorBody(res: Response): Promise<{
  code: string;
  details?: { fieldErrors?: Record<string, string[]> };
}> {
  return (await res.json()) as {
    code: string;
    details?: { fieldErrors?: Record<string, string[]> };
  };
}

describe("GET /api/ordenes/api-key — compatibilidad y borde (R1/R2/R3)", () => {
  it("R1: sin ninguno de los cuatro filtros nuevos -> misma pagina y mismos params que antes de 257", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("?limit=50&offset=0", SECRETO), deps(AUTH_OK, service));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination).toEqual({ limit: 50, offset: 0, total: 173 });
    expect(json.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega_central" });

    // Los params son los de 106: limit/offset/estado. Los cuatro nuevos van SIN definir, no con
    // un valor por defecto inventado (un `desde` implicito recortaria la pagina en silencio).
    expect(service.listar).toHaveBeenCalledWith(ACTOR, { limit: 50, offset: 0, estado: undefined });
    const params = paramsDeLaLlamada(service);
    expect(params.desde).toBeUndefined();
    expect(params.hasta).toBeUndefined();
    expect(params.numGuia).toBeUndefined();
    expect(params.numRemision).toBeUndefined();
  });

  it("R2: tiendaId/owner/ownerId en la query se ignoran, sin error y sin efecto en los params", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?tiendaId=otra&owner=x&ownerId=y&limit=10", SECRETO),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(200);
    expect(service.listar).toHaveBeenCalledWith(ACTOR, { limit: 10, offset: 0, estado: undefined });

    // El owner sigue siendo el actor de la key; nada derivado de esas claves entra en los params.
    const [actorRecibido, params] = vi.mocked(service.listar).mock.calls[0];
    expect(actorRecibido.usuarioId).toBe("store-1");
    expect(JSON.stringify(params)).not.toContain("otra");
    expect(Object.keys(params)).toEqual(
      expect.not.arrayContaining(["tiendaId", "owner", "ownerId"]),
    );
  });

  it("R3: query invalida SIN Bearer -> 401, no 422, y sin llamar al service", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?desde=hoy"),
      deps({ status: "unauthenticated" }, service),
    );
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R3: query invalida con key de usuario inactivo -> 403, no 422, y sin llamar al service", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?desde=hoy&num_guia=abc", SECRETO),
      deps({ status: "forbidden" }, service),
    );
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("GET /api/ordenes/api-key — rango de fechas (R4/R10/R11/R12)", () => {
  it("R4: desde/hasta en YYYY-MM-DD llegan al service como las cadenas literales", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?desde=2026-08-01&hasta=2026-08-21", SECRETO),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(200);
    const params = paramsDeLaLlamada(service);
    // El borde NO construye instantes: la conversion a las 06:00Z es del service (R7).
    expect(params.desde).toBe("2026-08-01");
    expect(params.hasta).toBe("2026-08-21");
  });

  it("R4: desde y hasta son independientes (solo desde, solo hasta)", async () => {
    const soloDesde = fakeService();
    await handleListadoApi(req("?desde=2026-08-01", SECRETO), deps(AUTH_OK, soloDesde));
    expect(paramsDeLaLlamada(soloDesde)).toMatchObject({ desde: "2026-08-01" });
    expect(paramsDeLaLlamada(soloDesde).hasta).toBeUndefined();

    const soloHasta = fakeService();
    await handleListadoApi(req("?hasta=2026-08-21", SECRETO), deps(AUTH_OK, soloHasta));
    expect(paramsDeLaLlamada(soloHasta)).toMatchObject({ hasta: "2026-08-21" });
    expect(paramsDeLaLlamada(soloHasta).desde).toBeUndefined();
  });

  it.each([
    ["?desde=22/07/2026", "desde"],
    ["?desde=2026-07-22T00:00:00Z", "desde"],
    ["?desde=hoy", "desde"],
    ["?desde=", "desde"],
    ["?hasta=22/07/2026", "hasta"],
    ["?hasta=2026-07-22T00:00:00Z", "hasta"],
    ["?hasta=hoy", "hasta"],
    ["?hasta=", "hasta"],
  ])(
    "R10: formato invalido %s -> 422 VALIDATION_ERROR con fieldErrors sobre %s y sin consultar",
    async (query, campo) => {
      const service = fakeService();
      const res = await handleListadoApi(req(query, SECRETO), deps(AUTH_OK, service));

      expect(res.status).toBe(422);
      const json = await errorBody(res);
      expect(json.code).toBe("VALIDATION_ERROR");
      expect(json.details?.fieldErrors?.[campo]).toBeDefined();
      // "Sin consultar la base de datos" es observable aqui como "el service no se llama": el
      // borde corta antes de instanciar nada que hable con Prisma.
      expect(service.listar).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["?desde=2026-02-31", "desde"],
    ["?hasta=2026-02-31", "hasta"],
    ["?desde=2026-13-01", "desde"],
    ["?hasta=2026-13-01", "hasta"],
  ])("R11: dia inexistente %s -> 422 y NO rueda al mes siguiente", async (query, campo) => {
    // OJO: new Date("2026-02-31") en V8 NO explota: rueda al 3 de marzo EN SILENCIO. Si el borde
    // validara solo la FORMA (un regex de cuatro-dos-dos digitos), esta query devolveria la
    // pagina del 3 de marzo y el integrador nunca se enteraria. Por eso se valida la fecha
    // CALENDARIO real, con round-trip.
    const service = fakeService();
    const res = await handleListadoApi(req(query, SECRETO), deps(AUTH_OK, service));

    expect(res.status).toBe(422);
    const json = await errorBody(res);
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details?.fieldErrors?.[campo]).toBeDefined();
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R12: desde posterior a hasta -> 422 con fieldErrors.hasta (no fieldErrors.desde)", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?desde=2026-08-21&hasta=2026-08-01", SECRETO),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(422);
    const json = await errorBody(res);
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details?.fieldErrors?.hasta).toBeDefined();
    expect(json.details?.fieldErrors?.desde).toBeUndefined();
    // NO es una pagina vacia silenciosa: el integrador se entera de que invirtio el rango.
    expect(res.status).not.toBe(200);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R12: desde igual a hasta es valido (el dia completo, no un rango invertido)", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?desde=2026-08-21&hasta=2026-08-21", SECRETO),
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(200);
    expect(paramsDeLaLlamada(service)).toMatchObject({ desde: "2026-08-21", hasta: "2026-08-21" });
  });
});

describe("GET /api/ordenes/api-key — num_guia (R13/R14)", () => {
  it("R13: num_guia=100234 -> 200 y el service recibe numGuia numerico", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("?num_guia=100234", SECRETO), deps(AUTH_OK, service));

    expect(res.status).toBe(200);
    const params = paramsDeLaLlamada(service);
    expect(params.numGuia).toBe(100234);
    expect(typeof params.numGuia).toBe("number"); // no la cadena "100234"
  });

  it.each([
    ["?num_guia=abc", "no numerico"],
    ["?num_guia=12.5", "decimal"],
    ["?num_guia=0", "cero"],
    ["?num_guia=-3", "negativo"],
    ["?num_guia=", "cadena vacia"],
  ])(
    "R14: num_guia invalido %s (%s) -> 422 con fieldErrors.num_guia y sin consultar",
    async (query) => {
      const service = fakeService();
      const res = await handleListadoApi(req(query, SECRETO), deps(AUTH_OK, service));

      expect(res.status).toBe(422);
      const json = await errorBody(res);
      expect(json.code).toBe("VALIDATION_ERROR");
      // La clave sale en snake_case, TAL CUAL llega en la query: el integrador debe poder casar
      // el error con el parametro que envio, no con el nombre interno `numGuia`.
      expect(json.details?.fieldErrors?.num_guia).toBeDefined();
      expect(json.details?.fieldErrors?.numGuia).toBeUndefined();
      expect(service.listar).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/ordenes/api-key — num_remision (R16/R17)", () => {
  it("R16: num_remision=REM-0001 -> 200 y el service lo recibe EXACTO", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?num_remision=REM-0001", SECRETO),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(200);
    expect(paramsDeLaLlamada(service).numRemision).toBe("REM-0001");
  });

  it("R16: el borde no baja a minusculas ni recorta el valor (solo trim de espacios de borde)", async () => {
    const mixto = fakeService();
    await handleListadoApi(req("?num_remision=ReM-0001-XyZ", SECRETO), deps(AUTH_OK, mixto));
    const valor = paramsDeLaLlamada(mixto).numRemision as string;
    expect(valor).toBe("ReM-0001-XyZ");
    expect(valor).not.toBe(valor.toLowerCase()); // nada de casefolding en el borde
    expect(valor.length).toBe("ReM-0001-XyZ".length); // nada de truncado por longitud

    // Lo unico que el borde toca son los espacios de los extremos (z.string().trim()).
    const conEspacios = fakeService();
    await handleListadoApi(
      req("?num_remision=%20REM-0001%20", SECRETO),
      deps(AUTH_OK, conEspacios),
    );
    expect(paramsDeLaLlamada(conEspacios).numRemision).toBe("REM-0001");
  });

  it.each([
    ["?num_remision=", "vacia"],
    ["?num_remision=%20%20%20", "solo espacios"],
  ])("R17: num_remision %s (%s) -> 422 con fieldErrors.num_remision", async (query) => {
    const service = fakeService();
    const res = await handleListadoApi(req(query, SECRETO), deps(AUTH_OK, service));

    expect(res.status).toBe(422);
    const json = await errorBody(res);
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.details?.fieldErrors?.num_remision).toBeDefined();
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("GET /api/ordenes/api-key — combinacion de filtros (R19)", () => {
  it("R19: combinacion sin resultados -> 200 con items vacios y total 0, nunca 404 ni 422", async () => {
    const service = fakeService({ listar: vi.fn().mockResolvedValue(paginaVacia()) });
    const res = await handleListadoApi(
      req("?estado=en_bodega_central&desde=2026-01-01&hasta=2026-01-02&num_guia=999999", SECRETO),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(422);
    const json = await res.json();
    expect(json.items).toEqual([]);
    expect(json.pagination.total).toBe(0);
  });

  it("R19: los cinco filtros (estado + desde + hasta + num_guia + num_remision) llegan en la MISMA llamada", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req(
        "?estado=en_bodega_central&desde=2026-08-01&hasta=2026-08-21&num_guia=100234&num_remision=REM-0001&limit=25&offset=50",
        SECRETO,
      ),
      deps(AUTH_OK, service),
    );

    expect(res.status).toBe(200);
    // AND, no OR y no "gana el ultimo": los cinco viajan juntos en una sola invocacion.
    expect(service.listar).toHaveBeenCalledTimes(1);
    expect(service.listar).toHaveBeenCalledWith(ACTOR, {
      limit: 25,
      offset: 50,
      estado: "en_bodega_central",
      desde: "2026-08-01",
      hasta: "2026-08-21",
      numGuia: 100234,
      numRemision: "REM-0001",
    });
  });
});
