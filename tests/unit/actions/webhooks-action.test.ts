import { describe, it, expect, vi } from "vitest";
import {
  registrarWebhook,
  desactivarWebhook,
  rotarSecretoWebhook,
  obtenerWebhook,
} from "@/lib/actions/webhooks";
import type { IWebhookSuscripcionService } from "@/lib/interfaces/services/IWebhookSuscripcionService";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";
import { WebhookSecretKeyError } from "@/lib/crypto/webhook-secret-cipher";

// Feature 99 (superficie de R9 — autorizacion por rol maestro, D1). La Server Action resuelve
// el actor server-side y solo `maestro` opera; valida que el owner objetivo es rol apiKey (D3)
// y devuelve el secreto UNA vez.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "adminTienda" };

function buildService(secret = "ordx_whsec_x"): IWebhookSuscripcionService {
  return {
    registrar: vi.fn(async () => ({ status: "creada", secret }) as const),
    rotarSecreto: vi.fn(async () => ({ status: "ok", secret }) as const),
    desactivar: vi.fn(async () => {}),
    obtener: vi.fn(async () => null),
  };
}

describe("registrarWebhook — autorizacion", () => {
  it("sin sesion -> unauthenticated", async () => {
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => null, service: buildService(), resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r.status).toBe("unauthenticated");
  });

  it("un no-maestro es rechazado (forbidden), sin tocar el service", async () => {
    const service = buildService();
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => ADMIN, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r.status).toBe("forbidden");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("un maestro da de alta y recibe el secreto una vez (creada)", async () => {
    const service = buildService("ordx_whsec_secreto-visible-una-vez");
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r).toEqual({ status: "creada", secret: "ordx_whsec_secreto-visible-una-vez" });
    expect(service.registrar).toHaveBeenCalledWith({
      ownerUsuarioId: "o1",
      url: "https://a.example.com",
    });
  });

  it("R33: editar la URL de un owner existente devuelve actualizada, sin secreto", async () => {
    const service: IWebhookSuscripcionService = {
      ...buildService(),
      registrar: vi.fn(async () => ({ status: "actualizada" }) as const),
    };
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://b.example.com" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r).toEqual({ status: "actualizada" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("D3/302: si la cuenta no participa del canal integrador -> owner_invalido, sin registrar", async () => {
    const service = buildService();
    const r = await registrarWebhook(
      { ownerUsuarioId: "o1", url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async () => null },
    );
    expect(r.status).toBe("owner_invalido");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("input invalido -> validation_error", async () => {
    const r = await registrarWebhook(
      { url: "https://a.example.com" },
      { getActor: async () => MAESTRO, service: buildService(), resolverOwnerWebhook: async (id: string) => id },
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
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r.status).toBe("ok");
    expect(service.desactivar).toHaveBeenCalledWith("o1");
  });
});

describe("rotarSecretoWebhook (gate P4) — autorizacion y contrato", () => {
  it("sin sesion -> unauthenticated", async () => {
    const r = await rotarSecretoWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => null, service: buildService() },
    );
    expect(r.status).toBe("unauthenticated");
  });

  it("un no-maestro es rechazado (forbidden), sin tocar el service", async () => {
    const service = buildService();
    const r = await rotarSecretoWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => ADMIN, service },
    );
    expect(r.status).toBe("forbidden");
    expect(service.rotarSecreto).not.toHaveBeenCalled();
  });

  it("input invalido -> validation_error", async () => {
    const r = await rotarSecretoWebhook(
      {},
      { getActor: async () => MAESTRO, service: buildService() },
    );
    expect(r.status).toBe("validation_error");
  });

  it("un maestro rota y recibe el nuevo secreto una vez", async () => {
    const service = buildService("ordx_whsec_rotado");
    const r = await rotarSecretoWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r).toEqual({ status: "ok", secret: "ordx_whsec_rotado" });
    expect(service.rotarSecreto).toHaveBeenCalledWith("o1");
  });

  it("sin suscripción -> not_found", async () => {
    const service: IWebhookSuscripcionService = {
      ...buildService(),
      rotarSecreto: vi.fn(async () => ({ status: "not_found" }) as const),
    };
    const r = await rotarSecretoWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r.status).toBe("not_found");
  });

  it("R32: si falta la clave de cifrado -> config_error (no propaga la excepcion)", async () => {
    const service: IWebhookSuscripcionService = {
      ...buildService(),
      rotarSecreto: vi.fn(async () => {
        throw new WebhookSecretKeyError("clave ausente");
      }),
    };
    const r = await rotarSecretoWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r.status).toBe("config_error");
  });
});

describe("obtenerWebhook (gate D2) — autorizacion y contrato", () => {
  it("sin sesion -> unauthenticated", async () => {
    const r = await obtenerWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => null, service: buildService() },
    );
    expect(r.status).toBe("unauthenticated");
  });

  it("un no-maestro es rechazado (forbidden), sin tocar el service", async () => {
    const service = buildService();
    const r = await obtenerWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => ADMIN, service },
    );
    expect(r.status).toBe("forbidden");
    expect(service.obtener).not.toHaveBeenCalled();
  });

  it("input invalido -> validation_error", async () => {
    const r = await obtenerWebhook(
      {},
      { getActor: async () => MAESTRO, service: buildService() },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R35: devuelve la vista {url, activa} y NUNCA el secreto", async () => {
    const service: IWebhookSuscripcionService = {
      ...buildService(),
      obtener: vi.fn(async () => ({ url: "https://a.example.com", activa: true })),
    };
    const r = await obtenerWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r).toEqual({ status: "ok", webhook: { url: "https://a.example.com", activa: true } });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(service.obtener).toHaveBeenCalledWith("o1");
  });

  it("sin suscripción devuelve webhook null (status ok)", async () => {
    const service: IWebhookSuscripcionService = {
      ...buildService(),
      obtener: vi.fn(async () => null),
    };
    const r = await obtenerWebhook(
      { ownerUsuarioId: "o1" },
      { getActor: async () => MAESTRO, service, resolverOwnerWebhook: async (id: string) => id },
    );
    expect(r).toEqual({ status: "ok", webhook: null });
  });
});
