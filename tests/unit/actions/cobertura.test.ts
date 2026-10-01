import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";

// Ficha 465 (T6) — el borde: sin sesion no se construye el servicio (R3); forbidden se propaga (R2).
//
// `getPrismaClient` se espia: si la accion construyera el servicio por el composition root sin
// sesion, esta espia lo veria. Es la forma medible de «sin leer datos».
const getPrismaClient = vi.fn(() => {
  throw new Error("no deberia construirse el cliente en este test");
});
vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient, PRISMA_OMIT: {} }));

const { listarCoberturaDistritos } = await import("@/lib/actions/cobertura");

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function serviceDoble(resultado: Awaited<ReturnType<ICoberturaService["listar"]>>) {
  return { listar: vi.fn(async () => resultado) } satisfies ICoberturaService;
}

describe("465/R3 — sin sesion", () => {
  it("devuelve unauthenticated SIN construir el servicio ni el cliente de base", async () => {
    const service = serviceDoble({ status: "ok", items: [], total: 0 });
    const r = await listarCoberturaDistritos({ getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(getPrismaClient).not.toHaveBeenCalled();

    // Y con un servicio inyectado tampoco se le llama.
    const r2 = await listarCoberturaDistritos({ getActor: async () => null, coberturaService: service });
    expect(r2).toEqual({ status: "unauthenticated" });
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("465/R2 — el resultado del servicio se propaga", () => {
  it("forbidden llega tal cual", async () => {
    const service = serviceDoble({ status: "forbidden" });
    const actor: Actor = { usuarioId: "u", rol: "adminTienda" };
    const r = await listarCoberturaDistritos({ getActor: async () => actor, coberturaService: service });
    expect(r).toEqual({ status: "forbidden" });
    expect(service.listar).toHaveBeenCalledWith(actor);
  });

  it("ok llega tal cual, con el actor de la sesion", async () => {
    const service = serviceDoble({ status: "ok", items: [], total: 0 });
    const r = await listarCoberturaDistritos({ getActor: async () => MAESTRO, coberturaService: service });
    expect(r).toEqual({ status: "ok", items: [], total: 0 });
    expect(service.listar).toHaveBeenCalledWith(MAESTRO);
  });
});
