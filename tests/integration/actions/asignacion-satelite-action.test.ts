import { describe, it, expect, vi } from "vitest";
import {
  asignarDesdeSatelite,
  listarMensajerosSatelite,
} from "@/lib/actions/recepcion-satelite";
import type { IAsignacionSateliteService } from "@/lib/interfaces/services/IAsignacionSateliteService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 34 — Server Actions de la asignacion satelite (borde). Cubre R1/R15/R19
// (asignarDesdeSatelite) y R2/R5/R6 (listarMensajerosSatelite). Dobles inyectados
// por `deps`, patron recepcion-satelite-action.test.ts.

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

// uuids validos para pasar el schema zod (ordenIds/mensajeroId).
const ORDEN = "11111111-1111-4111-8111-111111111111";
const MENSAJERO = "22222222-2222-4222-8222-222222222222";

const noActor = async () => null;
const actorAdmin = async () => ADMIN;
const actorMaestro = async () => MAESTRO;

function buildService(
  overrides: Partial<IAsignacionSateliteService> = {},
): IAsignacionSateliteService {
  return {
    asignar: vi.fn(async () => ({
      status: "ok" as const,
      resultados: [{ ordenId: ORDEN, estado: "en_espera_aceptacion" as const }],
    })),
    ...overrides,
  };
}

// --- asignarDesdeSatelite ---

describe("asignarDesdeSatelite — borde (R1/R15/R19)", () => {
  it("R1/R15: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await asignarDesdeSatelite(
      { ordenIds: [ORDEN], mensajeroId: MENSAJERO },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.asignar).not.toHaveBeenCalled();
  });

  it("R19: ordenIds vacio -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await asignarDesdeSatelite(
      { ordenIds: [], mensajeroId: MENSAJERO },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.asignar).not.toHaveBeenCalled();
  });

  it("R19: mensajeroId no-uuid -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await asignarDesdeSatelite(
      { ordenIds: [ORDEN], mensajeroId: "no-uuid" },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.asignar).not.toHaveBeenCalled();
  });

  it("R7: happy path delega y devuelve el resultado del service", async () => {
    const service = buildService();
    const r = await asignarDesdeSatelite(
      { ordenIds: [ORDEN], mensajeroId: MENSAJERO },
      { service, getActor: actorAdmin },
    );
    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: ORDEN, estado: "en_espera_aceptacion" }],
    });
    expect(service.asignar).toHaveBeenCalledWith(
      { ordenIds: [ORDEN], mensajeroId: MENSAJERO },
      ADMIN,
    );
  });

  it("resultado de dominio del service pasa tal cual (conflict)", async () => {
    const service = buildService({
      asignar: vi.fn(async () => ({
        status: "conflict" as const,
        detalle: [{ ordenId: ORDEN, motivo: "zona_ajena" }],
      })),
    });
    const r = await asignarDesdeSatelite(
      { ordenIds: [ORDEN], mensajeroId: MENSAJERO },
      { service, getActor: actorAdmin },
    );
    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: ORDEN, motivo: "zona_ajena" }],
    });
  });
});

// --- listarMensajerosSatelite (R2/R5/R6) ---

type MensajerosRepo = Pick<IOrdenRepository, "findUsuarioZonaId" | "findMensajerosByZona">;

function buildRepo(overrides: Partial<MensajerosRepo> = {}): MensajerosRepo {
  return {
    findUsuarioZonaId: vi.fn(async () => "z-satelite"),
    findMensajerosByZona: vi.fn(async () => [{ id: MENSAJERO, nombre: "Ana" }]),
    ...overrides,
  };
}

describe("listarMensajerosSatelite — scoped a la zona del actor (R2/R5/R6)", () => {
  it("R1: sin sesion -> unauthenticated", async () => {
    const ordenRepo = buildRepo();
    const r = await listarMensajerosSatelite({ ordenRepo, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(ordenRepo.findUsuarioZonaId).not.toHaveBeenCalled();
  });

  it("rol != adminSatelite -> forbidden, sin resolver zona", async () => {
    const ordenRepo = buildRepo();
    const r = await listarMensajerosSatelite({ ordenRepo, getActor: actorMaestro });
    expect(r.status).toBe("forbidden");
    expect(ordenRepo.findUsuarioZonaId).not.toHaveBeenCalled();
  });

  it("R2/R5: solo mensajeros de la zona del actor (findMensajerosByZona con esa zona)", async () => {
    const ordenRepo = buildRepo();
    const r = await listarMensajerosSatelite({ ordenRepo, getActor: actorAdmin });
    expect(r).toEqual({ status: "ok", mensajeros: [{ id: MENSAJERO, nombre: "Ana" }] });
    // R2: la zona se resuelve server-side por el usuarioId del actor.
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("as1");
    expect(ordenRepo.findMensajerosByZona).toHaveBeenCalledWith("z-satelite");
  });

  it("R6: adminSatelite sin zona (null) -> lista vacia, sin listar mensajeros", async () => {
    const ordenRepo = buildRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await listarMensajerosSatelite({ ordenRepo, getActor: actorAdmin });
    expect(r).toEqual({ status: "ok", mensajeros: [] });
    expect(ordenRepo.findMensajerosByZona).not.toHaveBeenCalled();
  });
});
