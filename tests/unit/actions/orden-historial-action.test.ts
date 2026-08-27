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
    clase: "transicion",
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
    // Feature 47 (R15): el ok trae ademas intentos (derivado) y umbral, propagados por props.
    obtenerHistorial: vi.fn(async () => ({
      status: "ok" as const,
      entradas: [entrada()],
      intentos: 0,
      umbral: 3,
    })),
    contarIntentos: vi.fn(async () => 0),
    // Pedido humano 2026-08-27: el contrato gano ademas el conjunto de «ya gestionadas»
    // (insumo de «eliminar orden»). Tampoco lo usa este borde.
    idsConGestionPosteriorEnLote: vi.fn(async () => new Set<string>()),
    // Feature 160: el contrato del servicio gano el conteo EN LOTE (no lo usa este borde).
    contarIntentosEnLote: vi.fn(async () => new Map<string, number>()),
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
    // Feature 47 (R15): el borde propaga intentos/umbral tal cual del service (por props).
    expect(r.intentos).toBe(0);
    expect(r.umbral).toBe(3);
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
