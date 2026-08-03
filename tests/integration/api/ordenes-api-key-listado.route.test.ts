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

describe("GET /api/ordenes/api-key — autenticacion (R1/R2/R3)", () => {
  it("R1: sin Bearer -> 401 y autenticar recibe null, sin llamar al service", async () => {
    const spyAuth = vi.fn(async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult);
    const service = fakeService();
    const res = await handleListadoApi(req(), deps({ status: "unauthenticated" }, service, spyAuth));
    expect(res.status).toBe(401);
    expect(spyAuth).toHaveBeenCalledWith(null);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R2: key inexistente (autenticar unauthenticated) -> 401", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("", SECRETO), deps({ status: "unauthenticated" }, service));
    expect(res.status).toBe(401);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R3: usuario inactivo (forbidden) -> 403", async () => {
    const service = fakeService();
    const res = await handleListadoApi(req("", SECRETO), deps({ status: "forbidden" }, service));
    expect(res.status).toBe(403);
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("GET /api/ordenes/api-key — listado (R8/R9/R10)", () => {
  it("R10: 200 con items + pagination (total)", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=50&offset=0", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination).toEqual({ limit: 50, offset: 0, total: 173 });
    expect(json.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega_central" });
  });

  it("R8: ignora tiendaId de la query (el service recibe el actor, no el input)", async () => {
    const service = fakeService();
    await handleListadoApi(
      req("?tiendaId=store-999&limit=10", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(service.listar).toHaveBeenCalledWith(ACTOR, { limit: 10, offset: 0, estado: undefined });
  });

  it("R9: limit > 100 -> 422, sin consultar", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=150", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R9: limit no numerico -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?limit=abc", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("R9: offset negativo -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?offset=-5", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
  });

  it("estado fuera del catalogo -> 422", async () => {
    const service = fakeService();
    const res = await handleListadoApi(
      req("?estado=inventado", SECRETO),
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
  });
});
