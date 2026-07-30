import { describe, it, expect, vi } from "vitest";
import {
  registrarEgresoAdministrativoAction,
  reversarEgresoAdministrativoAction,
  verDesgloseEgresosAction,
} from "@/lib/actions/wallet-egresos";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletEgresoService } from "@/lib/interfaces/services/IWalletEgresoService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 45 (R4/R5/R11/R17/R18/R19) — tests unit de las Server Actions de egresos. Sin sesion
// -> unauthenticated (R18); rol no autorizado -> forbidden (lo decide el service, R17); zod en
// el borde -> validation_error (monto <=0/vacio R4, descripcion vacia R5, tipoEgreso fuera del
// set incl. "gasto_fijo" R19). DTOs STRING (R12).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(): WalletMovimientoDTO {
  return {
    id: "eg-1",
    tipo: "egreso",
    categoria: "egreso_gasto_variable",
    monto: "1500.00",
    origenTipo: "gasto",
    origenId: null,
    descripcion: "Papeleria",
    registradoPor: "u-maestro",
    fechaMovimiento: "2026-07-13T10:00:00.000Z",
  };
}

function fakeService(overrides: Partial<IWalletEgresoService> = {}): IWalletEgresoService {
  return {
    registrarEgreso: vi.fn(async () => ({ status: "ok" as const, movimiento: mov() })),
    reversarEgreso: vi.fn(async () => ({ status: "ok" as const })),
    verDesgloseEgresos: vi.fn(async () => ({
      status: "ok" as const,
      desglose: {
        gastoFijo: "0.00",
        gastoVariable: "0.00",
        sueldo: "0.00",
        indemnizacion: "0.00", // feature 158/R32
        total: "0.00",
      },
    })),
    ...overrides,
  };
}

describe("registrarEgresoAdministrativoAction (R4/R5/R17/R18/R19)", () => {
  it("R18: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_variable", monto: "100.00", descripcion: "x" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("R17: rol no autorizado -> forbidden (lo decide el service)", async () => {
    const service = fakeService({ registrarEgreso: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "sueldo", monto: "100.00", descripcion: "x" },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R19: tipoEgreso 'gasto_fijo' (lo emite el cron) -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_fijo", monto: "100.00", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("R19: tipoEgreso desconocido -> validation_error", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "otro", monto: "100.00", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R4: monto no positivo -> validation_error", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_variable", monto: "0", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("R4: monto vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_variable", monto: "", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R5: descripcion vacia -> validation_error", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_variable", monto: "100.00", descripcion: "   " },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("maestro con egreso valido -> ok, movimiento con monto STRING", async () => {
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_variable", monto: "1500.00", descripcion: "Papeleria" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.movimiento.monto).toBe("string");
  });
});

describe("reversarEgresoAdministrativoAction (R13/R17/R18)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await reversarEgresoAdministrativoAction(
      { movimientoId: "11111111-1111-4111-8111-111111111111" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("movimientoId no-uuid -> validation_error", async () => {
    const service = fakeService();
    const r = await reversarEgresoAdministrativoAction(
      { movimientoId: "no-uuid" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.reversarEgreso).not.toHaveBeenCalled();
  });

  it("R17: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ reversarEgreso: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await reversarEgresoAdministrativoAction(
      { movimientoId: "11111111-1111-4111-8111-111111111111" },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("already_reversed (idempotencia) se propaga desde el service", async () => {
    const service = fakeService({ reversarEgreso: vi.fn(async () => ({ status: "already_reversed" as const })) });
    const r = await reversarEgresoAdministrativoAction(
      { movimientoId: "11111111-1111-4111-8111-111111111111" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "already_reversed" });
  });
});

describe("verDesgloseEgresosAction (R11/R17/R18)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await verDesgloseEgresosAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R11: maestro -> desglose con totales STRING", async () => {
    const service = fakeService();
    const r = await verDesgloseEgresosAction({}, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.desglose.total).toBe("string");
  });
});
