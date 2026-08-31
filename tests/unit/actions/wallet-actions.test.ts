import { describe, it, expect, afterEach, vi } from "vitest";
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
  // Ficha 339 (T1.3): las dos cubetas nuevas. Aqui van a 0,00 y los 300 siguen en «otros»,
  // asi que este archivo mide exactamente lo que medía: el BORDE, no la particion.
  egresos: {
    egreso_pago_mensajero: "0.00",
    egreso_ajuste: "0.00",
  },
  otrosEgresos: "300.00",
  totalEgresos: "300.00",
  hayOtrosEgresos: true, // 300,00 sin clasificar ⇒ el servidor manda pintar la fila
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
    // Ficha 339 (T3.4): el doble implementa la interfaz COMPLETA. El detalle de una fila lo
    // ejercita `wallet-detalle-fila-action.test.ts`.
    listarMovimientosDeFila: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [mov()], total: 1, page: 1, pageSize: 10 },
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
    // Ficha 339 (T3.4): la lista pasa de cuatro a CINCO acciones, y el añadido es deliberado
    // — `listarMovimientosDeFilaAction`, el detalle de una fila de la tarjeta de la ganancia.
    // Se actualiza el literal en vez de derivarlo del propio módulo: este censo ES el contrato
    // de superficie del borde de la wallet, y derivarlo lo dejaría siempre verde.
    expect(Object.keys(acciones).sort()).toEqual([
      "listarMovimientosAction",
      "listarMovimientosCompletoAction",
      "listarMovimientosDeFilaAction",
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


// ── Ficha 334 (T C.3) — la fecha invalida NO llega al servicio ──
//
// Se prueba EN EL BORDE y con el espia a cero llamadas: es donde la ficha promete que una
// fecha imposible no escribe ni una fila (R12/R20/R21). Un test de servicio no lo demostraria,
// porque el servicio ni siquiera valida la fecha — la valida zod aqui.

describe("registrarMovimientoManualAction — la fecha del movimiento (R20/R21)", () => {
  /** 09:00 CR del 29 de agosto de 2026. */
  const AHORA = "2026-08-29T15:00:00.000Z";

  afterEach(() => {
    vi.useRealTimers();
  });

  function conRelojEnAhora(): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AHORA));
  }

  function ajuste(fecha: string) {
    return {
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "50.00",
      descripcion: "correccion",
      fecha,
    };
  }

  it("R20: fecha FUTURA -> validation_error con la clave `fecha`, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarMovimientoManualAction(ajuste("2026-08-30"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    // La clave importa: el dialogo pinta el mensaje BAJO su campo, no en un aviso suelto.
    expect(Object.keys(r.fieldErrors)).toContain("fecha");
    expect(r.fieldErrors.fecha).toContain("La fecha no puede ser posterior a hoy.");
    expect(service.registrarMovimientoManual).not.toHaveBeenCalled();
  });

  it("R21: dia que NO existe (2026-02-31) -> validation_error, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarMovimientoManualAction(ajuste("2026-02-31"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrarMovimientoManual).not.toHaveBeenCalled();
  });

  it("fecha fuera de la ventana hacia atras -> validation_error, sin tocar el service", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarMovimientoManualAction(ajuste("2019-03-04"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrarMovimientoManual).not.toHaveBeenCalled();
  });

  it("R22: una fecha valida del pasado SI llega al servicio, tal cual, como texto", async () => {
    // CONTROL DE NO-VACUIDAD de los tres casos de arriba: si el borde rechazara TODA fecha,
    // aquellos pasarian igual y no dirian nada.
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarMovimientoManualAction(ajuste("2026-08-28"), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("ok");
    expect(service.registrarMovimientoManual).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: "2026-08-28", monto: "50.00" }),
      MAESTRO,
    );
  });

  it("sin la clave `fecha` la entrada sigue siendo valida — el camino de siempre", async () => {
    conRelojEnAhora();
    const service = fakeService();
    const r = await registrarMovimientoManualAction(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    const entrada = (service.registrarMovimientoManual as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(Object.keys(entrada)).not.toContain("fecha");
  });
});
