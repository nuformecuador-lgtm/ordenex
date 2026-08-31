import { describe, it, expect, afterEach, vi } from "vitest";
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
    dueno: "propio", // feature 231 (R31): un gasto variable es dinero de Ordenex
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


// ── Ficha 334 (T C.3) — la fecha invalida NO llega al servicio (espejo del ajuste manual) ──

describe("registrarEgresoAdministrativoAction — la fecha del egreso (R20/R21)", () => {
  /** 09:00 CR del 29 de agosto de 2026. */
  const AHORA = "2026-08-29T15:00:00.000Z";

  afterEach(() => {
    vi.useRealTimers();
  });

  function conRelojEnAhora(): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AHORA));
  }

  function gasto(fecha: string) {
    return { tipoEgreso: "gasto_variable", monto: "1500.00", descripcion: "Papeleria", fecha };
  }

  it("R20: fecha FUTURA -> validation_error con la clave `fecha`, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(gasto("2026-08-30"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(Object.keys(r.fieldErrors)).toContain("fecha");
    expect(r.fieldErrors.fecha).toContain("La fecha no puede ser posterior a hoy.");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("R21: dia que NO existe (2026-02-31) -> validation_error, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(gasto("2026-02-31"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("fecha fuera de la ventana hacia atras -> validation_error, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(gasto("2019-03-04"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("R22: una fecha valida del pasado SI llega al servicio, tal cual, como texto", async () => {
    // CONTROL DE NO-VACUIDAD de los tres casos de arriba.
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(gasto("2026-08-28"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("ok");
    expect(service.registrarEgreso).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-08-28", monto: "1500.00" }),
      MAESTRO,
    );
  });

  it("R19: `gasto_fijo` sigue cayendo aunque la fecha sea impecable", async () => {
    // La regla del gasto FIJO no se debilita al ganar la fecha: el `z.enum` la sostiene.
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "gasto_fijo", monto: "100.00", descripcion: "x", fecha: "2026-08-28" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.registrarEgreso).not.toHaveBeenCalled();
  });

  it("sin la clave `fecha` la entrada sigue siendo valida — el camino de siempre", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarEgresoAdministrativoAction(
      { tipoEgreso: "sueldo", monto: "100.00", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    const entrada = (service.registrarEgreso as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(entrada)).not.toContain("fecha");
  });
});
