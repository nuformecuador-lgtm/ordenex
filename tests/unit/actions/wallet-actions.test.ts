import { describe, it, expect, vi } from "vitest";
import {
  listarMovimientosAction,
  verBalanceAction,
  registrarMovimientoManualAction,
} from "@/lib/actions/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 42 (T10) — tests unit de las Server Actions de wallet (R19/R21/R25). Sin sesion
// -> unauthenticated; rol no autorizado -> forbidden (el service lo decide); DTOs STRING.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(): WalletMovimientoDTO {
  return {
    id: "w1",
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
  };
}

function fakeService(overrides: Partial<IWalletService> = {}): IWalletService {
  return {
    listarMovimientos: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [mov()], total: 1, page: 1, pageSize: 20 },
    })),
    verBalance: vi.fn(async () => ({
      status: "ok" as const,
      balance: { ingresos: "1000.00", egresos: "300.00", balance: "700.00", signo: "positivo" as const },
    })),
    registrarMovimientoManual: vi.fn(async () => ({ status: "ok" as const, movimiento: mov() })),
    ...overrides,
  };
}

describe("listarMovimientosAction (R19/R25)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarMovimientosAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarMovimientos).not.toHaveBeenCalled();
  });

  it("R19: rol no autorizado -> forbidden (el service decide, sin exponer datos)", async () => {
    const service = fakeService({ listarMovimientos: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarMovimientosAction({}, { service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R25: maestro -> ok con DTOs de monto STRING", async () => {
    const service = fakeService();
    const r = await listarMovimientosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.data.movimientos[0].monto).toBe("string");
  });

  it("input invalido (pageSize fuera de rango) -> validation_error", async () => {
    const service = fakeService();
    const r = await listarMovimientosAction(
      { page: 1, pageSize: 9999 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarMovimientos).not.toHaveBeenCalled();
  });
});

describe("verBalanceAction (R19/R21/R25)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await verBalanceAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R19: rol no autorizado -> forbidden, sin balance", async () => {
    const service = fakeService({ verBalance: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await verBalanceAction({}, { service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R25: maestro -> balance con montos STRING y signo", async () => {
    const service = fakeService();
    const r = await verBalanceAction({}, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.balance.balance).toBe("string");
    expect(r.balance.signo).toBe("positivo");
  });
});

describe("registrarMovimientoManualAction (R15/R19)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await registrarMovimientoManualAction(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R19: rol no autorizado -> forbidden", async () => {
    const service = fakeService({
      registrarMovimientoManual: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await registrarMovimientoManualAction(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("descripcion vacia -> validation_error (zod en el borde), sin tocar el service", async () => {
    const service = fakeService();
    const r = await registrarMovimientoManualAction(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.registrarMovimientoManual).not.toHaveBeenCalled();
  });

  it("monto no positivo -> validation_error", async () => {
    const service = fakeService();
    const r = await registrarMovimientoManualAction(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "0", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R15: maestro con ajuste valido -> ok, movimiento con monto STRING", async () => {
    const service = fakeService();
    const r = await registrarMovimientoManualAction(
      { tipo: "egreso", categoria: "egreso_ajuste", monto: "50.00", descripcion: "correccion" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.movimiento.monto).toBe("string");
  });
});
