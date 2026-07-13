import { describe, it, expect, vi } from "vitest";
import {
  listarCierresAdmin,
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
} from "@/lib/actions/cierres-admin";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 38 — tests de integracion de las Server Actions de "Cierres del dia" del
// admin (patron cierre-dia-action.test.ts). Cubre R1 (`unauthenticated` sin sesion),
// R11 (rechazar con motivo vacio -> validation_error en el borde por zod) y la
// delegacion en el service con deps inyectadas.

const CIERRE_ID = "11111111-1111-4111-8111-111111111111"; // uuid valido para el zod del borde
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const noActor = async () => null;
const actorMaestro = async () => MAESTRO;

function fakeService(overrides: Partial<ICierresAdminService> = {}): ICierresAdminService {
  return {
    listarCierresAdmin: vi.fn(async () => ({ status: "ok", pendientes: [], historico: [], sinZona: false })),
    verCierreDetalle: vi.fn(async () => ({ status: "no_encontrada" })),
    aprobarCierre: vi.fn(async () => ({ status: "ok", cierreId: CIERRE_ID, estado: "aprobado" })),
    rechazarCierre: vi.fn(async () => ({ status: "ok", cierreId: CIERRE_ID, estado: "rechazado" })),
    ...overrides,
  } as ICierresAdminService;
}

describe("cierres-admin actions — unauthenticated en el borde (R1)", () => {
  it("listarCierresAdmin sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarCierresAdmin({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarCierresAdmin).not.toHaveBeenCalled();
  });

  it("verCierreDetalle sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verCierreDetalle({ cierreId: CIERRE_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.verCierreDetalle).not.toHaveBeenCalled();
  });

  it("aprobarCierre sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await aprobarCierre({ cierreId: CIERRE_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.aprobarCierre).not.toHaveBeenCalled();
  });

  it("rechazarCierre sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "cuadre" },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.rechazarCierre).not.toHaveBeenCalled();
  });
});

describe("cierres-admin actions — validacion de borde con zod (R11)", () => {
  it("R11: rechazarCierre con motivo vacio -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "   " },
      { service, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazarCierre).not.toHaveBeenCalled();
  });

  it("verCierreDetalle con cierreId no-uuid -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verCierreDetalle({ cierreId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.verCierreDetalle).not.toHaveBeenCalled();
  });
});

describe("cierres-admin actions — delegacion en el service", () => {
  it("listarCierresAdmin con actor -> delega y devuelve el resultado del service", async () => {
    const service = fakeService({
      listarCierresAdmin: vi.fn(async () => ({
        status: "ok" as const,
        pendientes: [],
        historico: [],
        sinZona: false,
      })),
    });
    const r = await listarCierresAdmin({ service, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(service.listarCierresAdmin).toHaveBeenCalledWith(MAESTRO);
  });

  it("aprobarCierre con actor -> delega con el cierreId parseado", async () => {
    const service = fakeService();
    const r = await aprobarCierre({ cierreId: CIERRE_ID }, { service, getActor: actorMaestro });
    expect(r).toMatchObject({ status: "ok", estado: "aprobado" });
    expect(service.aprobarCierre).toHaveBeenCalledWith(CIERRE_ID, MAESTRO);
  });

  it("rechazarCierre con motivo -> delega con cierreId + motivo (trim del zod) + actor", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "  cuadre no coincide  " },
      { service, getActor: actorMaestro },
    );
    expect(r).toMatchObject({ status: "ok", estado: "rechazado" });
    expect(service.rechazarCierre).toHaveBeenCalledWith(CIERRE_ID, "cuadre no coincide", MAESTRO);
  });
});
