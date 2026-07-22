import { describe, it, expect, vi } from "vitest";
import { registrarWebhook, desactivarWebhook } from "@/lib/actions/webhooks";
import type { IWebhookSuscripcionService } from "@/lib/interfaces/services/IWebhookSuscripcionService";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

// Feature 99 (superficie de R9 — autorizacion por rol maestro, D1). La Server Action resuelve
// el actor server-side y solo `maestro` opera; valida que el owner objetivo es rol apiKey (D3)
// y devuelve el secreto UNA vez.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "adminTienda" };

function buildService(secret = "ordx_whsec_x"): IWebhookSuscripcionService {
  return {
    registrar: vi.fn(async () => ({ status: "ok", secret }) as const),
    desactivar: vi.fn(async () => {}),
    obtener: vi.fn(async () => null),
  };
}

describe("registrarWebhook — autorizacion", () => {
  it("sin sesion -> unauthenticated", async () => {
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => null, service: buildService(), ownerEsApiKey: async () => true },
    );
    expect(r.status).toBe("unauthenticated");
  });

  it("un no-maestro es rechazado (forbidden), sin tocar el service", async () => {
    const service = buildService();
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => ADMIN, service, ownerEsApiKey: async () => true },
    );
    expect(r.status).toBe("forbidden");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("un maestro registra y recibe el secreto una vez", async () => {
    const service = buildService("ordx_whsec_secreto-visible-una-vez");
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service, ownerEsApiKey: async () => true },
    );
    expect(r).toEqual({ status: "ok", secret: "ordx_whsec_secreto-visible-una-vez" });
    expect(service.registrar).toHaveBeenCalledWith({
      ownerUsuarioId: "o1",
      url: "https://a.example.com",
    });
  });

  it("D3: si el owner objetivo no es rol apiKey -> owner_invalido, sin registrar", async () => {
    const service = buildService();
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service, ownerEsApiKey: async () => false },
    );
    expect(r.status).toBe("owner_invalido");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("input invalido -> validation_error", async () => {
    const r = await registrarWebhook(
      { url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service: buildService(), ownerEsApiKey: async () => true },
    );
    expect(r.status).toBe("validation_error");
  });
});

describe("desactivarWebhook — autorizacion", () => {
  it("un no-maestro es rechazado", async () => {
    const service = buildService();
    const r = await desactivarWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => ADMIN, service },
    );
    expect(r.status).toBe("forbidden");
    expect(service.desactivar).not.toHaveBeenCalled();
  });

  it("un maestro da de baja", async () => {
    const service = buildService();
    const r = await desactivarWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service },
    );
    expect(r.status).toBe("ok");
    expect(service.desactivar).toHaveBeenCalledWith("o1");
  });
});
