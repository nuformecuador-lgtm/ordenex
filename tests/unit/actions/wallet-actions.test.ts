import { describe, it, expect, vi } from "vitest";
import {
  listarMovimientosAction,
  verResumenCajaAction,
  verBalanceAction,
  registrarMovimientoManualAction,
} from "@/lib/actions/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { CajaResumenDTO, WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 42 (T10) — tests unit de las Server Actions de wallet (R19/R21/R25). Sin sesion
// -> unauthenticated; rol no autorizado -> forbidden (el service lo decide); DTOs STRING.
//
// Feature 173 (T D.2, R64/R65): `verBalanceAction` deja de hablar con `verBalance` —que ya no
// existe— y pasa a ser una PROYECCION de `verResumenCajaAction`, el borde nuevo. El cambio de
// estas aserciones esta declarado en `design.md §11`.

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

/**
 * Feature 173 — un resumen con dinero de las DOS naturalezas: `enCaja` (5700) y `ganancia`
 * (700) son DISTINTOS a proposito, para que ninguna asercion de este archivo pueda pasar por
 * casualidad confundiendo una cifra con la otra.
 */
const RESUMEN: CajaResumenDTO = {
  entradas: "6000.00",
  salidas: "300.00",
  enCaja: "5700.00",
  signoEnCaja: "positivo",
  ingresosPropios: "1000.00",
  egresosPropios: "300.00",
  ganancia: "700.00",
  signoGanancia: "positivo",
  deTerceros: "5000.00",
  periodoFiltrado: false,
};

function fakeService(overrides: Partial<IWalletService> = {}): IWalletService {
  return {
    listarMovimientos: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [mov()], total: 1, page: 1, pageSize: 20 },
    })),
    // Feature 170 (T C.1): el doble implementa la interfaz COMPLETA. El modo sin
    // paginacion lo ejercita `wallet-caja-descarga-action.test.ts`.
    listarMovimientosCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [mov()],
      total: 1,
    })),
    verResumenCaja: vi.fn(async () => ({ status: "ok" as const, resumen: RESUMEN })),
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

describe("verResumenCajaAction (R8/R64/R65)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verResumenCajaAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.verResumenCaja).not.toHaveBeenCalled();
  });

  it("R65: rol no autorizado -> forbidden, y NI UNA cifra en la respuesta", async () => {
    const service = fakeService({
      verResumenCaja: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await verResumenCajaAction({}, { service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
    expect(Object.keys(r)).toEqual(["status"]);
  });

  it("R64: maestro -> el DTO cruza con los NUEVE importes como STRING", async () => {
    const service = fakeService();
    const r = await verResumenCajaAction({}, { service, getActor: async () => MAESTRO });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    // Se barre el DTO ENTERO, no tres campos elegidos a mano: cualquier importe futuro que
    // alguien añada como `number` cae aqui. `periodoFiltrado` es el unico booleano y no es
    // dinero.
    for (const [clave, valor] of Object.entries(r.resumen)) {
      if (clave === "periodoFiltrado") {
        expect(typeof valor).toBe("boolean");
        continue;
      }
      expect(typeof valor).toBe("string");
    }
    expect(r.resumen.enCaja).toBe("5700.00");
    expect(r.resumen.ganancia).toBe("700.00");
    expect(r.resumen.signoEnCaja).toBe("positivo");
  });

  it("R8: usa el MISMO schema del listado — un filtro invalido es validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verResumenCajaAction(
      { page: 1, pageSize: 9999 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.verResumenCaja).not.toHaveBeenCalled();
  });

  it("[P7]: `periodoFiltrado` viaja tal cual desde el service; el borde no lo decide", async () => {
    const service = fakeService({
      verResumenCaja: vi.fn(async () => ({
        status: "ok" as const,
        resumen: { ...RESUMEN, periodoFiltrado: true },
      })),
    });
    const r = await verResumenCajaAction(
      { tipo: "ingreso" },
      { service, getActor: async () => MAESTRO },
    );
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.resumen.periodoFiltrado).toBe(true);
  });
});

describe("verBalanceAction — PUENTE de la 173 hasta `T G.3`", () => {
  it("sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await verBalanceAction({}, { service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R19: rol no autorizado -> forbidden, sin balance", async () => {
    const service = fakeService({
      verResumenCaja: vi.fn(async () => ({ status: "forbidden" as const })),
    });
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

  it("el puente es una PROYECCION del resumen, no una segunda derivacion", async () => {
    // La unica razon de que `/wallet` siga en pie hasta la Tanda G. Lo que se afirma es que el
    // numero que ve la pantalla vieja es EXACTAMENTE `enCaja` —el mismo que devolvia la 42—, y
    // que en ningun caso es la GANANCIA: si alguien confundiera los campos al proyectar, la
    // pantalla empezaria a mostrar la utilidad bajo el rotulo «Balance general».
    const service = fakeService();
    const puente = await verBalanceAction({}, { service, getActor: async () => MAESTRO });
    const resumen = await verResumenCajaAction({}, { service, getActor: async () => MAESTRO });
    if (puente.status !== "ok" || resumen.status !== "ok") throw new Error("esperado ok");

    expect(puente.balance).toEqual({
      ingresos: resumen.resumen.entradas,
      egresos: resumen.resumen.salidas,
      balance: resumen.resumen.enCaja,
      signo: resumen.resumen.signoEnCaja,
    });
    expect(puente.balance.balance).not.toBe(resumen.resumen.ganancia);
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
