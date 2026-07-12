import { describe, it, expect, vi } from "vitest";
import {
  listarConsolidacion,
  solicitarCierreBodega,
  listarCierresBodegaAdmin,
  verCierreBodegaDetalle,
  aprobarCierreBodega,
  rechazarCierreBodega,
} from "@/lib/actions/cierre-bodega";
import type { ICierreBodegaService } from "@/lib/interfaces/services/ICierreBodegaService";
import type { ICierresBodegaAdminService } from "@/lib/interfaces/services/ICierresBodegaAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 40 — tests de integracion de las Server Actions del "Cierre de bodega"
// (patron cierres-admin-action.test.ts). Cubre R1/R2 (`unauthenticated` sin sesion; rol
// via service), R17 (rechazar motivo vacio -> validation_error del borde zod) y el borde
// de aprobar/rechazar/ver con id invalido -> validation_error.

const CB_ID = "11111111-1111-4111-8111-111111111111"; // uuid valido para el zod del borde
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const noActor = async () => null;
const actorSat = async () => ADMIN_SATELITE;
const actorMaestro = async () => MAESTRO;

function fakeCierreBodegaService(
  overrides: Partial<ICierreBodegaService> = {},
): ICierreBodegaService {
  return {
    listarConsolidacion: vi.fn(async () => ({
      status: "ok" as const,
      consolidables: [],
      totalesAgregados: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      puedesSolicitar: false,
      motivoBloqueo: null,
      cierresBodegaPasados: [],
      sinZona: false,
    })),
    solicitarCierreBodega: vi.fn(async () => ({
      status: "ok" as const,
      cierreBodegaId: CB_ID,
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    })),
    ...overrides,
  } as ICierreBodegaService;
}

function fakeAdminService(
  overrides: Partial<ICierresBodegaAdminService> = {},
): ICierresBodegaAdminService {
  return {
    listarCierresBodegaAdmin: vi.fn(async () => ({ status: "ok" as const, pendientes: [], historico: [] })),
    verCierreBodegaDetalle: vi.fn(async () => ({ status: "no_encontrada" as const })),
    aprobarCierreBodega: vi.fn(async () => ({ status: "ok" as const, cierreBodegaId: CB_ID, estado: "aprobado" as const })),
    rechazarCierreBodega: vi.fn(async () => ({ status: "ok" as const, cierreBodegaId: CB_ID, estado: "rechazado" as const })),
    ...overrides,
  } as ICierresBodegaAdminService;
}

describe("cierre-bodega actions — unauthenticated en el borde (R1/R2)", () => {
  it("listarConsolidacion sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierreBodegaService = fakeCierreBodegaService();
    const r = await listarConsolidacion({ cierreBodegaService, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(cierreBodegaService.listarConsolidacion).not.toHaveBeenCalled();
  });

  it("solicitarCierreBodega sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierreBodegaService = fakeCierreBodegaService();
    const r = await solicitarCierreBodega({ cierreBodegaService, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(cierreBodegaService.solicitarCierreBodega).not.toHaveBeenCalled();
  });

  it("listarCierresBodegaAdmin sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await listarCierresBodegaAdmin({ cierresBodegaAdminService, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(cierresBodegaAdminService.listarCierresBodegaAdmin).not.toHaveBeenCalled();
  });

  it("verCierreBodegaDetalle sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await verCierreBodegaDetalle({ cierreBodegaId: CB_ID }, { cierresBodegaAdminService, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(cierresBodegaAdminService.verCierreBodegaDetalle).not.toHaveBeenCalled();
  });

  it("aprobarCierreBodega sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await aprobarCierreBodega({ cierreBodegaId: CB_ID }, { cierresBodegaAdminService, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(cierresBodegaAdminService.aprobarCierreBodega).not.toHaveBeenCalled();
  });

  it("rechazarCierreBodega sin sesion -> unauthenticated, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await rechazarCierreBodega(
      { cierreBodegaId: CB_ID, motivo: "cuadre" },
      { cierresBodegaAdminService, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(cierresBodegaAdminService.rechazarCierreBodega).not.toHaveBeenCalled();
  });
});

describe("cierre-bodega actions — validacion de borde con zod (R17)", () => {
  it("R17: rechazarCierreBodega con motivo vacio -> validation_error, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await rechazarCierreBodega(
      { cierreBodegaId: CB_ID, motivo: "   " },
      { cierresBodegaAdminService, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(cierresBodegaAdminService.rechazarCierreBodega).not.toHaveBeenCalled();
  });

  it("verCierreBodegaDetalle con cierreBodegaId no-uuid -> validation_error, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await verCierreBodegaDetalle({ cierreBodegaId: "no-es-uuid" }, { cierresBodegaAdminService, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(cierresBodegaAdminService.verCierreBodegaDetalle).not.toHaveBeenCalled();
  });

  it("aprobarCierreBodega con cierreBodegaId no-uuid -> validation_error, sin tocar el service", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await aprobarCierreBodega({ cierreBodegaId: "x" }, { cierresBodegaAdminService, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(cierresBodegaAdminService.aprobarCierreBodega).not.toHaveBeenCalled();
  });

  it("rechazarCierreBodega con cierreBodegaId no-uuid (motivo valido) -> validation_error", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await rechazarCierreBodega(
      { cierreBodegaId: "x", motivo: "cuadre" },
      { cierresBodegaAdminService, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(cierresBodegaAdminService.rechazarCierreBodega).not.toHaveBeenCalled();
  });
});

describe("cierre-bodega actions — delegacion en el service (R1/R2)", () => {
  it("R1: listarConsolidacion con actor -> delega y devuelve el resultado del service", async () => {
    const cierreBodegaService = fakeCierreBodegaService();
    const r = await listarConsolidacion({ cierreBodegaService, getActor: actorSat });
    expect(r.status).toBe("ok");
    expect(cierreBodegaService.listarConsolidacion).toHaveBeenCalledWith(ADMIN_SATELITE);
  });

  it("R1: solicitarCierreBodega con actor -> delega", async () => {
    const cierreBodegaService = fakeCierreBodegaService();
    const r = await solicitarCierreBodega({ cierreBodegaService, getActor: actorSat });
    expect(r).toMatchObject({ status: "ok", cierreBodegaId: CB_ID });
    expect(cierreBodegaService.solicitarCierreBodega).toHaveBeenCalledWith(ADMIN_SATELITE);
  });

  it("R2: listarCierresBodegaAdmin con actor -> delega", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await listarCierresBodegaAdmin({ cierresBodegaAdminService, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(cierresBodegaAdminService.listarCierresBodegaAdmin).toHaveBeenCalledWith(MAESTRO);
  });

  it("R2: aprobarCierreBodega con actor -> delega con el id parseado", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await aprobarCierreBodega({ cierreBodegaId: CB_ID }, { cierresBodegaAdminService, getActor: actorMaestro });
    expect(r).toMatchObject({ status: "ok", estado: "aprobado" });
    expect(cierresBodegaAdminService.aprobarCierreBodega).toHaveBeenCalledWith(CB_ID, MAESTRO);
  });

  it("R2/R17: rechazarCierreBodega con motivo -> delega con id + motivo (trim del zod) + actor", async () => {
    const cierresBodegaAdminService = fakeAdminService();
    const r = await rechazarCierreBodega(
      { cierreBodegaId: CB_ID, motivo: "  cuadre no coincide  " },
      { cierresBodegaAdminService, getActor: actorMaestro },
    );
    expect(r).toMatchObject({ status: "ok", estado: "rechazado" });
    expect(cierresBodegaAdminService.rechazarCierreBodega).toHaveBeenCalledWith(CB_ID, "cuadre no coincide", MAESTRO);
  });
});
