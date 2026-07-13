import { describe, it, expect, vi } from "vitest";
import { obtenerHistorialOrden } from "@/lib/actions/orden-historial";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (T4.3, R28) — tests de la Server Action de lectura del historial. Sin sesion
// -> unauthenticated (sin tocar el service); ok con datos; forbidden/not_found propagados
// del service. Inyeccion de deps (service/getActor), patron liberacion-reprogramada.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function entrada(): OrdenHistorialEntradaDTO {
  return {
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda X",
    motivo: null,
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
  };
}

function fakeService(overrides: Partial<IOrdenHistorialService> = {}): IOrdenHistorialService {
  return {
    obtenerHistorial: vi.fn(async () => ({ status: "ok" as const, entradas: [entrada()] })),
    contarIntentos: vi.fn(async () => 0),
    ...overrides,
  };
}

describe("obtenerHistorialOrden (R28)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await obtenerHistorialOrden("o1", { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.obtenerHistorial).not.toHaveBeenCalled();
  });

  it("con sesion -> ok con las entradas del service (datos por props, R28)", async () => {
    const service = fakeService();
    const r = await obtenerHistorialOrden("o1", { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.entradas).toHaveLength(1);
    expect(service.obtenerHistorial).toHaveBeenCalledWith("o1", MAESTRO);
  });

  it("propaga forbidden del service (sin filtrar datos)", async () => {
    const service = fakeService({ obtenerHistorial: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await obtenerHistorialOrden("o1", { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("propaga not_found del service", async () => {
    const service = fakeService({ obtenerHistorial: vi.fn(async () => ({ status: "not_found" as const })) });
    const r = await obtenerHistorialOrden("o1", { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "not_found" });
  });
});
