import { describe, it, expect, vi } from "vitest";
import {
  handleCancelarApi,
  PUT,
  type CancelarApiDeps,
} from "@/app/api/ordenes/api-key/[numGuia]/cancelar/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  ApiOrdenCancelacionResult,
  IApiOrdenCancelacionService,
} from "@/lib/interfaces/services/IApiOrdenCancelacionService";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function fakeService(result: ApiOrdenCancelacionResult): IApiOrdenCancelacionService {
  return { cancelar: vi.fn().mockResolvedValue(result) };
}

function deps(auth: ApiKeyAuthResult, service: IApiOrdenCancelacionService): CancelarApiDeps {
  return { autenticar: async () => auth, cancelacionService: service };
}

function req(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/10234/cancelar", {
    method: "PUT",
    headers,
  });
}

describe("PUT /api/ordenes/api-key/[numGuia]/cancelar — auth (R1/R3)", () => {
  it("R1: sin/mal Bearer -> 401", async () => {
    const service = fakeService({ status: "not_found" });
    const res = await handleCancelarApi(req(), "10234", deps({ status: "unauthenticated" }, service));
    expect(res.status).toBe(401);
    expect(service.cancelar).not.toHaveBeenCalled();
  });

  it("R3: usuario inactivo -> 403", async () => {
    const service = fakeService({ status: "not_found" });
    const res = await handleCancelarApi(req(SECRETO), "10234", deps({ status: "forbidden" }, service));
    expect(res.status).toBe(403);
    expect(service.cancelar).not.toHaveBeenCalled();
  });
});

describe("PUT /api/ordenes/api-key/[numGuia]/cancelar — cancelacion (R19/R20/R23)", () => {
  it("R19: 200 transiciona a devuelta_origen", async () => {
    const service = fakeService({
      status: "ok",
      data: { numGuia: 10234, estadoAnterior: "en_bodega", estado: "devuelta_origen" },
    });
    const res = await handleCancelarApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      numGuia: 10234,
      estadoAnterior: "en_bodega",
      estado: "devuelta_origen",
    });
    expect(service.cancelar).toHaveBeenCalledWith(ACTOR, 10234);
  });

  it("R20: 409 desde estado no cancelable", async () => {
    const service = fakeService({ status: "conflict" });
    const res = await handleCancelarApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(409);
  });

  it("R23: 404 ajena/inexistente", async () => {
    const service = fakeService({ status: "not_found" });
    const res = await handleCancelarApi(
      req(SECRETO),
      "77777",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(404);
  });

  it("el handler responde al verbo PUT (no expone POST)", async () => {
    // El modulo exporta PUT y NO POST (decision (c) del gate).
    const mod = await import("@/app/api/ordenes/api-key/[numGuia]/cancelar/route");
    expect(typeof PUT).toBe("function");
    expect((mod as Record<string, unknown>).POST).toBeUndefined();
  });
});
