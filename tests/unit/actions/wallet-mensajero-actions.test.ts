import { describe, it, expect, vi } from "vitest";
import {
  verMiCuentaPorPagarAction,
  listarMisPagosAction,
  listarCuentasPorPagarAction,
  listarPagosDeMensajeroAction,
} from "@/lib/actions/wallet-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletMensajeroService } from "@/lib/interfaces/services/IWalletMensajeroService";
import type { CuentaPorPagarDTO } from "@/lib/types/wallet-mensajero";

// Feature 44 (T13) — tests unit de las Server Actions del libro del pago por mensajero
// (R19/R20/R21/R27). Sin sesion -> unauthenticated; rol no autorizado -> forbidden (el service
// decide); input invalido -> validation_error (zod en el borde); DTOs con montos STRING (nunca
// number).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const CUENTA: CuentaPorPagarDTO = { devengado: "1000.00", pagado: "300.00", cuentaPorPagar: "700.00", signo: "positivo" };

function fakeService(overrides: Partial<IWalletMensajeroService> = {}): IWalletMensajeroService {
  return {
    verMiCuentaPorPagar: vi.fn(async () => ({ status: "ok" as const, cuenta: CUENTA })),
    listarMisPagos: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [], total: 0, page: 1, pageSize: 20, cuenta: CUENTA },
    })),
    listarCuentasPorPagar: vi.fn(async () => ({
      status: "ok" as const,
      mensajeros: [{ mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00", cuentaPorPagar: "700.00", signo: "positivo" as const }],
    })),
    listarPagosDeMensajero: vi.fn(async () => ({
      status: "ok" as const,
      data: {
        mensajeroId: "m1",
        mensajeroNombre: "Ana Mensajera",
        movimientos: [],
        total: 0,
        page: 1,
        pageSize: 20,
        cuenta: CUENTA,
      },
    })),
    // Feature 170 (T C.1): el doble implementa la interfaz COMPLETA. Los modos sin
    // paginacion los ejercitan `wallet-mis-pagos-descarga-action.test.ts` y
    // `wallet-desglose-mensajero-descarga-action.test.ts`.
    listarMisPagosCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarPagosDeMensajeroCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    ...overrides,
  };
}

describe("verMiCuentaPorPagarAction (R20/R27)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.verMiCuentaPorPagar).not.toHaveBeenCalled();
  });

  it("R20: rol no autorizado -> forbidden (el service decide)", async () => {
    const service = fakeService({ verMiCuentaPorPagar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: mensajero -> ok con cuenta por pagar STRING+signo", async () => {
    const service = fakeService();
    const r = await verMiCuentaPorPagarAction({ service, getActor: async () => MENSAJERO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.cuenta.cuentaPorPagar).toBe("string");
    expect(r.cuenta.signo).toBe("positivo");
  });
});

describe("listarMisPagosAction (R20/R22/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("input invalido (pageSize fuera de rango) -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction(
      { page: 1, pageSize: 9999 },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarMisPagos).not.toHaveBeenCalled();
  });

  it("R20: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ listarMisPagos: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarMisPagosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: mensajero -> ok con cuenta STRING", async () => {
    const service = fakeService();
    const r = await listarMisPagosAction({ page: 1, pageSize: 20 }, { service, getActor: async () => MENSAJERO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.data.cuenta.cuentaPorPagar).toBe("string");
  });
});

describe("listarCuentasPorPagarAction (R18/R19/R27)", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R19: rol no maestro -> forbidden", async () => {
    const service = fakeService({ listarCuentasPorPagar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => MENSAJERO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R27: maestro -> ok con cuentas por pagar STRING por mensajero", async () => {
    const service = fakeService();
    const r = await listarCuentasPorPagarAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(typeof r.mensajeros[0].cuentaPorPagar).toBe("string");
    expect(typeof r.mensajeros[0].devengado).toBe("string");
  });
});

describe("listarPagosDeMensajeroAction (R18/R22/R27 — vista del MAESTRO)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20 },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("mensajeroId FALTANTE -> validation_error (el maestro debe elegir mensajero), sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("validation_error");
    expect(r.fieldErrors).toHaveProperty("mensajeroId");
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("mensajeroId vacio/invalido -> validation_error", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "", page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.listarPagosDeMensajero).not.toHaveBeenCalled();
  });

  it("R19: rol no maestro -> forbidden (el service decide)", async () => {
    const service = fakeService({ listarPagosDeMensajero: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20 },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R18/R22/R27: maestro -> ok con desglose por cierre + cuenta STRING del conjunto filtrado", async () => {
    const service = fakeService();
    const r = await listarPagosDeMensajeroAction(
      { mensajeroId: "m1", page: 1, pageSize: 20, cierreId: "c2" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    expect(r.data.mensajeroId).toBe("m1");
    expect(typeof r.data.mensajeroNombre).toBe("string");
    expect(typeof r.data.cuenta.cuentaPorPagar).toBe("string");
    // el service recibio el input parseado con el mensajeroId elegido por el maestro.
    expect(service.listarPagosDeMensajero).toHaveBeenCalledWith(
      expect.objectContaining({ mensajeroId: "m1", cierreId: "c2" }),
      MAESTRO,
    );
  });
});
