import { describe, it, expect, vi } from "vitest";
import {
  listarMovimientosAction,
  verResumenCajaAction,
  registrarMovimientoManualAction,
} from "@/lib/actions/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  WalletMovimientoDTO,
} from "@/lib/types/wallet";

// Feature 42 (T10) — tests unit de las Server Actions de wallet (R19/R21/R25). Sin sesion
// -> unauthenticated; rol no autorizado -> forbidden (el service lo decide); DTOs STRING.
//
// Feature 173 (T D.2, R64/R65): `verBalanceAction` dejo de hablar con `verBalance` —que ya no
// existe— y paso a ser una PROYECCION de `verResumenCajaAction`, el borde nuevo. El cambio de
// estas aserciones esta declarado en `design.md §11`.
//
// Feature 173 (Tanda H): ese puente se RETIRA. `T G.3` lo dejo sin un solo consumidor en `app/`
// y esta tanda lo borra; los cuatro casos que lo median se sustituyen por UNO que afirma que la
// forma vieja no puede volver.

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
    // Feature 231 (R31): el flete es dinero de Ordenex.
    dueno: "propio",
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
  // Feature 231 (R9/R10): 5000 / 5700 x 100 = 87.719… -> "87.72", con las dos cifras > 0.
  porcentajeTiendas: "87.72",
  modoComposicion: "dos_bolsillos",
};

/**
 * Feature 231 (design §2.2) — la composicion que viaja HERMANA del resumen. Cuadra con el:
 * `totalIngresos` = `ingresosPropios` (1000) y `totalEgresos` = `egresosPropios` (300).
 */
const COMPOSICION: ComposicionGananciaDTO = {
  ingresos: {
    ingreso_flete: "1000.00",
    ingreso_flete_devolucion: "0.00",
    ingreso_comision_cod: "0.00",
    ingreso_iva_flete: "0.00",
    ingreso_iva_flete_devolucion: "0.00",
    ingreso_iva_comision_cod: "0.00",
    ingreso_ajuste: "0.00",
  },
  totalIngresos: "1000.00",
  otrosEgresos: "300.00",
  totalEgresos: "300.00",
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
    verResumenCaja: vi.fn(async () => ({
      status: "ok" as const,
      resumen: RESUMEN,
      composicion: COMPOSICION,
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
        composicion: COMPOSICION,
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

describe("el PUENTE `verBalanceAction` ya no existe (173, Tanda H)", () => {
  it("el modulo de acciones de la wallet no exporta ninguna accion de «balance»", async () => {
    // El puente vivio entre la Tanda D y la Tanda G, declarado como tal desde el primer dia:
    // `T D.2` retiro `WalletService.verBalance` y `/wallet` todavia era la pantalla de la 42.
    // `T G.3` lo dejo sin consumidores; la Tanda H lo retira. Este caso sustituye a los cuatro
    // que median el puente: lo que se afirma ahora es que la forma vieja NO puede volver por la
    // puerta de atras, ni con ese nombre ni con ningun otro.
    const acciones = await import("@/lib/actions/wallet");

    expect(Object.keys(acciones).filter((k) => /balance/i.test(k))).toEqual([]);
    // Control de no-vacuidad del `toEqual([])`: el modulo SI exporta acciones, y son las cuatro
    // que quedan. Si el import fallara o devolviera un objeto vacio, el filtro de arriba pasaria
    // sin haber mirado nada.
    expect(Object.keys(acciones).sort()).toEqual([
      "listarMovimientosAction",
      "listarMovimientosCompletoAction",
      "registrarMovimientoManualAction",
      "verResumenCajaAction",
    ]);
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
