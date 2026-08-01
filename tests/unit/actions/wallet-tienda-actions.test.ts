import { describe, it, expect, vi } from "vitest";
import {
  verMiSaldoAction,
  listarMisMovimientosAction,
  listarSaldosTiendasAction,
} from "@/lib/actions/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

// Feature 43 (T13) — tests unit de las Server Actions del ledger por tienda (R19/R20/R21/R27).
// Sin sesion -> unauthenticated; rol no autorizado -> forbidden (el service decide); input
// invalido -> validation_error (zod en el borde); DTOs con montos STRING (nunca number).

const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const SALDO: SaldoTiendaDTO = { creditos: "10000.00", debitos: "1500.00", saldo: "8500.00", signo: "positivo" };

function fakeService(overrides: Partial<IWalletTiendaService> = {}): IWalletTiendaService {
  return {
    verMiSaldo: vi.fn(async () => ({ status: "ok" as const, saldo: SALDO })),
    listarMisMovimientos: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [], total: 0, page: 1, pageSize: 20, saldo: SALDO },
    })),
    // Feature 170 (T C.1): el doble implementa la interfaz COMPLETA. El modo sin
    // paginacion lo ejercita `wallet-tienda-descarga-action.test.ts`.
    listarMisMovimientosCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarSaldosTiendas: vi.fn(async () => ({
      status: "ok" as const,
      tiendas: [{ tiendaId: "t1", tiendaNombre: "Tienda Uno", saldo: "8500.00", signo: "positivo" as const }],
    })),
    ...overrides,
  };
}

describe("verMiSaldoAction (R19/R27)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verMiSaldoAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.verMiSaldo).not.toHaveBeenCalled();
  });

  it("R19: rol no autorizado -> forbidden (el service decide)", async () => {
    const service = fakeService({ verMiSaldo: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await verMiSaldoAction({ service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: adminTienda -> ok con saldo STRING+signo", async () => {
    const service = fakeService();
    const r = await verMiSaldoAction({ service, getActor: async () => TIENDA });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.saldo.saldo).toBe("string");
    expect(r.saldo.signo).toBe("positivo");
  });
});

describe("listarMisMovimientosAction (R19/R22/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarMisMovimientosAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("input invalido (pageSize fuera de rango) -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarMisMovimientosAction(
      { page: 1, pageSize: 9999 },
      { service, getActor: async () => TIENDA },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarMisMovimientos).not.toHaveBeenCalled();
  });

  it("R19: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ listarMisMovimientos: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarMisMovimientosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: adminTienda -> ok con saldo STRING", async () => {
    const service = fakeService();
    const r = await listarMisMovimientosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => TIENDA });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.data.saldo.saldo).toBe("string");
  });
});

describe("listarSaldosTiendasAction (R20/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarSaldosTiendasAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R20: rol no maestro -> forbidden", async () => {
    const service = fakeService({ listarSaldosTiendas: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarSaldosTiendasAction({ service, getActor: async () => TIENDA });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: maestro -> ok con saldos STRING por tienda", async () => {
    const service = fakeService();
    const r = await listarSaldosTiendasAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.tiendas[0].saldo).toBe("string");
  });
});
