import { describe, it, expect, vi } from "vitest";
import { handleDetalleApi, type DetalleApiDeps } from "@/app/api/ordenes/api-key/[numGuia]/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type { ApiOrdenDetalleDTO } from "@/lib/types/api-orden";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okDetalle(overrides: Partial<ApiOrdenDetalleDTO> = {}): ApiOrdenDetalleDTO {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estado: "entregada",
    destinatario: "Ana",
    telefonoDest: "099",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    evidencias: [
      {
        resultado: "entregada",
        contentType: "image/jpeg",
        url: "https://proyecto.supabase.co/storage/v1/object/sign/xyz",
        expiraEnSegundos: 300,
      },
    ],
    ...overrides,
  };
}

function fakeService(detalle: ApiOrdenDetalleDTO | null): IApiOrdenLecturaService {
  return { listar: vi.fn(), detalle: vi.fn().mockResolvedValue(detalle) };
}

function deps(auth: ApiKeyAuthResult, service: IApiOrdenLecturaService): DetalleApiDeps {
  return { autenticar: async () => auth, lecturaService: service };
}

function req(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/10234", { method: "GET", headers });
}

describe("GET /api/ordenes/api-key/[numGuia] — auth (R1)", () => {
  it("R1: sin/mal Bearer -> 401", async () => {
    const service = fakeService(okDetalle());
    const res = await handleDetalleApi(req(), "10234", deps({ status: "unauthenticated" }, service));
    expect(res.status).toBe(401);
    expect(service.detalle).not.toHaveBeenCalled();
  });
});

describe("GET /api/ordenes/api-key/[numGuia] — detalle (R12/R13/R14/R15/R16/R18)", () => {
  it("R12/R15: 200 con evidencias firmadas", async () => {
    const service = fakeService(okDetalle());
    const res = await handleDetalleApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.numGuia).toBe(10234);
    expect(json.evidencias[0]).toMatchObject({
      resultado: "entregada",
      url: expect.stringContaining("sign/"),
      expiraEnSegundos: 300,
    });
    // El service recibe el actor (owner forzado).
    expect(service.detalle).toHaveBeenCalledWith(ACTOR, 10234);
  });

  it("R13: inexistente (service null) -> 404", async () => {
    const service = fakeService(null);
    const res = await handleDetalleApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(404);
  });

  it("R14: ajena (service null) -> 404 (misma respuesta que inexistente)", async () => {
    const service = fakeService(null);
    const res = await handleDetalleApi(
      req(SECRETO),
      "77777",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(404);
  });

  it("R18: 200 con evidencias: []", async () => {
    const service = fakeService(okDetalle({ evidencias: [] }));
    const res = await handleDetalleApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.evidencias).toEqual([]);
  });

  it("R16: la respuesta no expone storagePath, bucket ni datos del mensajero", async () => {
    const service = fakeService(okDetalle());
    const res = await handleDetalleApi(
      req(SECRETO),
      "10234",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    const texto = await res.text();
    expect(texto).not.toMatch(/storagePath|storage_path|mensajero|gestion-evidencias/i);
  });

  it("num_guia no numerico -> 422", async () => {
    const service = fakeService(okDetalle());
    const res = await handleDetalleApi(
      req(SECRETO),
      "abc",
      deps({ status: "ok", actor: ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.detalle).not.toHaveBeenCalled();
  });
});
