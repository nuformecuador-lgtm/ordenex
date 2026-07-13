import { describe, it, expect, vi } from "vitest";
import { devolverATienda } from "@/lib/actions/devolucion-origen";
import type { IDevolucionOrigenService } from "@/lib/interfaces/services/IDevolucionOrigenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 48/T6.1 — borde (Server Action) del retorno a la tienda. `unauthenticated` (sin
// sesion) y `validation_error` (ordenId no-uuid) se resuelven en el borde ANTES del service;
// el resto (ok/forbidden/not_found/conflict/config_error) los devuelve el service tal cual.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ORDEN_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function buildService(overrides: Partial<IDevolucionOrigenService> = {}): IDevolucionOrigenService {
  return {
    devolverATienda: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorMaestro = async () => MAESTRO;

describe("devolverATienda (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service (R11)", async () => {
    const service = buildService();
    const r = await devolverATienda({ ordenId: ORDEN_UUID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.devolverATienda).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service (R4)", async () => {
    const service = buildService();
    const r = await devolverATienda({ ordenId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.devolverATienda).not.toHaveBeenCalled();
  });

  it("input sin ordenId (forma invalida) -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await devolverATienda({}, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.devolverATienda).not.toHaveBeenCalled();
  });

  it("actor sin permiso -> forbidden del service pasa como resultado de dominio (sin efectos)", async () => {
    const service = buildService({
      devolverATienda: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await devolverATienda({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("forbidden");
    expect(service.devolverATienda).toHaveBeenCalledWith(ORDEN_UUID, MAESTRO);
  });

  it("ordenId uuid valido delega en el service con el actor y devuelve ok", async () => {
    const service = buildService();
    const r = await devolverATienda({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(service.devolverATienda).toHaveBeenCalledWith(ORDEN_UUID, MAESTRO);
  });

  it("conflict del service (estado != rechazada) pasa tal cual", async () => {
    const service = buildService({
      devolverATienda: vi.fn(async () => ({ status: "conflict" as const, motivo: "la orden no esta en rechazada" })),
    });
    const r = await devolverATienda({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("conflict");
  });

  it("un error EXCEPCIONAL del service NO se propaga crudo (withErrorHandler)", async () => {
    const service = buildService({
      devolverATienda: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      devolverATienda({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
