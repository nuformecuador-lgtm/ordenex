import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICajaKardexService } from "@/lib/interfaces/services/ICajaKardexService";
import type { ICuentaKardexService } from "@/lib/interfaces/services/ICuentaKardexService";
import { ORIGENES_FALSOS } from "@/tests/fixtures/origenes-falsos";

// FICHA 468 / T9 — el BORDE de las seis acciones del kardex y sus COMPOSITION ROOTS, ejercitados de
// verdad (memoria «el composition root que no inyecta»: se llama a cada accion SIN `deps.service`, se
// construye por su root, y se exige que cada orquestador reciba sus dependencias REALES —el repositorio
// del mensajero y el de la caja incluidos—).

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };
const CUENTA = "00000000-0000-4000-8000-0000000000cc";

const capturas = vi.hoisted(() => ({ caja: [] as unknown[][], cuenta: [] as unknown[][] }));

vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: () => ({}), PRISMA_OMIT: {} }));

vi.mock("@/lib/services/LibroKardexService", () => ({
  CajaKardexService: class {
    constructor(...args: unknown[]) {
      capturas.caja.push(args);
    }
    async kardex() {
      return { status: "forbidden" as const };
    }
    async kardexConDetalle() {
      return { status: "forbidden" as const };
    }
  },
  CuentaKardexService: class {
    constructor(...args: unknown[]) {
      capturas.cuenta.push(args);
    }
    async kardex() {
      return { status: "forbidden" as const };
    }
    async kardexConDetalle() {
      return { status: "forbidden" as const };
    }
    async miKardex() {
      return { status: "forbidden" as const };
    }
    async miKardexConDetalle() {
      return { status: "forbidden" as const };
    }
  },
}));

const { libroCajaKardexAction, libroCajaKardexConDetalleAction } = await import("@/lib/actions/wallet");
const {
  estadoCuentaKardexAction,
  estadoCuentaKardexConDetalleAction,
  miEstadoCuentaKardexAction,
  miEstadoCuentaKardexConDetalleAction,
} = await import("@/lib/actions/estado-cuenta");
const { WalletService } = await import("@/lib/services/WalletService");
const { EstadoCuentaService } = await import("@/lib/services/EstadoCuentaService");
const { DetalleEnLoteService } = await import("@/lib/services/DetalleEnLoteService");
const { CierreAporteRepository } = await import("@/lib/repositories/CierreAporteRepository");
const { WalletTiendaMovimientoRepository } = await import("@/lib/repositories/WalletTiendaMovimientoRepository");
const { WalletMovimientoRepository } = await import("@/lib/repositories/WalletMovimientoRepository");
const { EstadoCuentaRepository } = await import("@/lib/repositories/EstadoCuentaRepository");

function afirmarLoteReal(d: unknown) {
  expect(d).toBeInstanceOf(DetalleEnLoteService);
  const interno = d as { aportes: unknown; movimientosDeTienda: unknown; movimientosDeMensajero: unknown };
  expect(interno.aportes).toBeInstanceOf(CierreAporteRepository);
  expect(interno.movimientosDeTienda).toBeInstanceOf(WalletTiendaMovimientoRepository);
  expect(interno.movimientosDeMensajero).toBeInstanceOf(EstadoCuentaRepository);
}

describe("468 — los roots del kardex PASAN sus dependencias reales", () => {
  it("caja: WalletService + WalletMovimientoRepository (saldo corrido) + DetalleEnLoteService con sus TRES repositorios", async () => {
    capturas.caja.length = 0;
    await libroCajaKardexAction({}, { getActor: async () => MAESTRO, origenes: ORIGENES_FALSOS });
    await libroCajaKardexConDetalleAction({}, { getActor: async () => MAESTRO, origenes: ORIGENES_FALSOS });
    expect(capturas.caja).toHaveLength(2);
    for (const [caja, saldos, lote, ...resto] of capturas.caja) {
      expect(resto).toEqual([]);
      expect(caja).toBeInstanceOf(WalletService);
      expect(saldos).toBeInstanceOf(WalletMovimientoRepository);
      afirmarLoteReal(lote);
    }
  });

  it("estado de cuenta (oficina y /mi-wallet): EstadoCuentaService + DetalleEnLoteService con sus TRES repositorios", async () => {
    capturas.cuenta.length = 0;
    const cuenta = { cuenta: { tipo: "mensajero", id: CUENTA } };
    await estadoCuentaKardexAction(cuenta, { getActor: async () => MAESTRO });
    await estadoCuentaKardexConDetalleAction(cuenta, { getActor: async () => MAESTRO });
    await miEstadoCuentaKardexAction({}, { getActor: async () => TIENDA });
    await miEstadoCuentaKardexConDetalleAction({}, { getActor: async () => TIENDA });
    expect(capturas.cuenta).toHaveLength(4);
    for (const [estadoCuenta, lote, ...resto] of capturas.cuenta) {
      expect(resto).toEqual([]);
      expect(estadoCuenta).toBeInstanceOf(EstadoCuentaService);
      afirmarLoteReal(lote);
    }
  });
});

describe("468 — el borde de las acciones del kardex", () => {
  const servicioCaja = (): ICajaKardexService & { kardex: ReturnType<typeof vi.fn>; kardexConDetalle: ReturnType<typeof vi.fn> } => ({
    kardex: vi.fn(async () => ({ status: "forbidden" as const })),
    kardexConDetalle: vi.fn(async () => ({ status: "forbidden" as const })),
  });
  const servicioCuenta = () => ({
    kardex: vi.fn(async () => ({ status: "forbidden" as const })),
    kardexConDetalle: vi.fn(async () => ({ status: "forbidden" as const })),
    miKardex: vi.fn(async () => ({ status: "forbidden" as const })),
    miKardexConDetalle: vi.fn(async () => ({ status: "forbidden" as const })),
  });

  it("sin sesion: unauthenticated en las seis, sin tocar el servicio", async () => {
    const caja = servicioCaja();
    const cuenta = servicioCuenta();
    const sinSesion = { getActor: async () => null };
    const entrada = { cuenta: { tipo: "tienda", id: CUENTA } };
    const resultados = [
      await libroCajaKardexAction({}, { ...sinSesion, service: caja }),
      await libroCajaKardexConDetalleAction({}, { ...sinSesion, service: caja }),
      await estadoCuentaKardexAction(entrada, { ...sinSesion, service: cuenta as unknown as ICuentaKardexService }),
      await estadoCuentaKardexConDetalleAction(entrada, { ...sinSesion, service: cuenta as unknown as ICuentaKardexService }),
      await miEstadoCuentaKardexAction({}, { ...sinSesion, service: cuenta as unknown as ICuentaKardexService }),
      await miEstadoCuentaKardexConDetalleAction({}, { ...sinSesion, service: cuenta as unknown as ICuentaKardexService }),
    ];
    expect(resultados.every((r) => r.status === "unauthenticated")).toBe(true);
    expect([...Object.values(caja), ...Object.values(cuenta)].every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("R25: la bodega con detalle es validation_error en el BORDE, sin llamar al servicio; sin detalle si pasa", async () => {
    const cuenta = servicioCuenta();
    const bodega = { cuenta: { tipo: "bodega", id: CUENTA } };
    const deps = { getActor: async () => MAESTRO, service: cuenta as unknown as ICuentaKardexService };
    const r = await estadoCuentaKardexConDetalleAction(bodega, deps);
    expect(r.status).toBe("validation_error");
    expect(cuenta.kardexConDetalle).not.toHaveBeenCalled();
    await estadoCuentaKardexAction(bodega, deps);
    expect(cuenta.kardex).toHaveBeenCalledTimes(1);
  });

  it("R24/R31: el mensajero SI tiene detalle por guia (la 464 lo rechazaba)", async () => {
    const cuenta = servicioCuenta();
    await estadoCuentaKardexConDetalleAction(
      { cuenta: { tipo: "mensajero", id: CUENTA } },
      { getActor: async () => MAESTRO, service: cuenta as unknown as ICuentaKardexService },
    );
    expect(cuenta.kardexConDetalle).toHaveBeenCalledTimes(1);
  });

  it("/mi-wallet: una `cuenta` en la entrada es validation_error sin leer nada (R36 de la 458-D)", async () => {
    const cuenta = servicioCuenta();
    const r = await miEstadoCuentaKardexConDetalleAction(
      { cuenta: { tipo: "tienda", id: CUENTA } },
      { getActor: async () => TIENDA, service: cuenta as unknown as ICuentaKardexService },
    );
    expect(r.status).toBe("validation_error");
    expect(cuenta.miKardexConDetalle).not.toHaveBeenCalled();
  });

  it("caja: una clave desconocida es validation_error (`.strict()`), y la entrada valida llega al servicio", async () => {
    const caja = servicioCaja();
    const deps = { getActor: async () => MAESTRO, service: caja, origenes: ORIGENES_FALSOS };
    expect((await libroCajaKardexAction({ page: 2 }, deps)).status).toBe("validation_error");
    expect(caja.kardex).not.toHaveBeenCalled();
    await libroCajaKardexConDetalleAction({ categoria: "ingreso_flete" }, deps);
    expect(caja.kardexConDetalle).toHaveBeenCalledWith(expect.objectContaining({ categoria: "ingreso_flete" }), MAESTRO);
  });

  it("468 (antes 464 T6): caja — filtros y término llegan al servicio, y el ok lleva el origen legible en cada fila con su kardex y su detalle tal cual", async () => {
    const kardex = {
      saldoInicial: "0.00",
      saldoFinal: "10.00",
      totales: { entra: "10.00", sale: "0.00", cobradoATiendas: "0.00" },
      conOtrosFiltros: true,
      filas: [{ monto: { columna: "entra" as const, monto: "10.00" }, saldo: "10.00", ordenes: 1 }],
    };
    const porGuia = { bloques: [], sinGuia: [], totalGeneral: kardex.totales };
    const fila = {
      id: "00000000-0000-4000-8000-0000000000d1",
      tipo: "ingreso" as const,
      categoria: "ingreso_flete" as const,
      monto: "10.00",
      origenTipo: "cierre_dia" as const,
      origenId: "00000000-0000-4000-8000-0000000000d2",
      descripcion: null,
      registradoPor: null,
      fechaMovimiento: "2026-09-20T15:00:00.000Z",
      dueno: "propio" as const,
      documento: null,
    };
    const caja = servicioCaja();
    caja.kardexConDetalle.mockResolvedValueOnce({ status: "ok", items: [fila], total: 1, kardex, porGuia });
    const r = await libroCajaKardexConDetalleAction(
      { q: "  flete  ", tipo: "ingreso", desde: "2026-09-01" },
      { getActor: async () => MAESTRO, service: caja, origenes: ORIGENES_FALSOS },
    );
    expect(caja.kardexConDetalle.mock.calls[0][0]).toMatchObject({ q: "flete", tipo: "ingreso" });
    expect(r).toEqual({
      status: "ok",
      items: [{ ...fila, origen: { texto: "Origen legible de prueba", enlace: null } }],
      total: 1,
      kardex,
      porGuia,
    });
  });
});
