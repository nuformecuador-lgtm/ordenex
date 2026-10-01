import { describe, it, expect, vi } from "vitest";

import { verEstadoCuentaAction, verEstadoCuentaCompletoAction, verMiEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import {
  listarMovimientosAction,
  listarMovimientosCompletoAction,
  listarMovimientosDeFilaAction,
  verResumenCajaAction,
} from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarSaldosTiendasCompletoAction, listarSaldosTiendasPaginadoAction } from "@/lib/actions/wallet-tienda";
import type { IWalletMovimientoRepository, ListarMovimientosFiltros, WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletEgresoService } from "@/lib/interfaces/services/IWalletEgresoService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import { WalletService } from "@/lib/services/WalletService";
import { descargaConfig } from "@/lib/config/descarga";
import { ORIGENES_FALSOS } from "@/tests/fixtures/origenes-falsos";

// FICHA 463 / T4 — los BORDES del libro de las wallets, con dobles de servicio.
//
//  · R14 — por la ACCION, no solo por el esquema: resumen, desglose y detalle de una fila de la
//    composicion con termino u orden ⇒ `validation_error` SIN tocar el servicio (sin leer nada).
//  · R40 — el libro de la caja y el estado de cuenta con direccion/campo invalidos ⇒ `validation_error`
//    sin tocar el servicio.
//  · El termino y el orden llegan al servicio (caja y estado de cuenta) y del servicio al repositorio
//    (caja); el resumen no los recibe porque su borde no los admite.
//  · R44 — la descarga del libro con termino y orden respeta el tope igual que hoy.
//  · R45 — la busqueda de saldos de tiendas llega al servicio en la pagina y en la descarga.

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };
const CUENTA = { tipo: "tienda", id: "00000000-0000-4000-8000-0000000000cc" } as const;

function walletEspia() {
  const ok = { status: "ok", data: { movimientos: [], total: 0, page: 1, pageSize: 20 } };
  return {
    listarMovimientos: vi.fn(async () => ok),
    listarMovimientosCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
    listarMovimientosDeFila: vi.fn(async () => ok),
    verResumenCaja: vi.fn(async () => ({ status: "forbidden" })),
  };
}

function egresosEspia() {
  return { verDesgloseEgresos: vi.fn(async () => ({ status: "forbidden" })) };
}

function estadoEspia() {
  return {
    leer: vi.fn(async () => ({ status: "no_encontrado" as const })),
    leerCompleto: vi.fn(async () => ({ status: "no_encontrado" as const })),
    leerMiTienda: vi.fn(async () => ({ status: "no_encontrado" as const })),
    leerMiTiendaCompleto: vi.fn(async () => ({ status: "no_encontrado" as const })),
  };
}

/** El primer argumento de la llamada `n` de un espia (los espias se declaran sin parametros). */
const argDe = (fn: { mock: { calls: unknown } }, n: number): unknown => (fn.mock.calls as unknown[][])[n]![0];

const TERMINO_U_ORDEN = [{ q: "Pedro" }, { sortDir: "desc" }, { sortDir: "asc" }, { sortBy: "fecha" }];

describe("463 — R14: las cifras de la caja rechazan termino y orden SIN leer", () => {
  for (const extra of TERMINO_U_ORDEN) {
    it(`verResumenCajaAction con ${JSON.stringify(extra)} ⇒ validation_error`, async () => {
      const espia = walletEspia();
      const r = await verResumenCajaAction(extra, { service: espia as unknown as IWalletService, getActor: async () => MAESTRO });
      expect(r.status).toBe("validation_error");
      expect(espia.verResumenCaja).not.toHaveBeenCalled();
    });
    it(`verDesgloseEgresosAction con ${JSON.stringify(extra)} ⇒ validation_error`, async () => {
      const espia = egresosEspia();
      const r = await verDesgloseEgresosAction(extra, { service: espia as unknown as IWalletEgresoService, getActor: async () => MAESTRO });
      expect(r.status).toBe("validation_error");
      expect(espia.verDesgloseEgresos).not.toHaveBeenCalled();
    });
    it(`listarMovimientosDeFilaAction con ${JSON.stringify(extra)} ⇒ validation_error`, async () => {
      const espia = walletEspia();
      const r = await listarMovimientosDeFilaAction(
        { fila: "egreso_pago_mensajero", ...extra },
        { service: espia as unknown as IWalletService, origenes: ORIGENES_FALSOS, getActor: async () => MAESTRO },
      );
      expect(r.status).toBe("validation_error");
      expect(espia.listarMovimientosDeFila).not.toHaveBeenCalled();
    });
  }

  it("control: sin termino ni orden, el resumen SI llega al servicio", async () => {
    const espia = walletEspia();
    await verResumenCajaAction({ tipo: "ingreso" }, { service: espia as unknown as IWalletService, getActor: async () => MAESTRO });
    expect(espia.verResumenCaja).toHaveBeenCalledTimes(1);
  });
});

describe("463 — el libro de la caja: termino y orden por la accion", () => {
  it("el termino recortado y el orden llegan al servicio (pagina)", async () => {
    const espia = walletEspia();
    const r = await listarMovimientosAction(
      { q: "  Pedro ", sortDir: "asc", tipo: "egreso" },
      { service: espia as unknown as IWalletService, origenes: ORIGENES_FALSOS, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    expect(espia.listarMovimientos).toHaveBeenCalledWith(
      { page: 1, pageSize: 20, tipo: "egreso", q: "Pedro", sortBy: "fecha", sortDir: "asc" },
      MAESTRO,
    );
  });

  it("R34: sin orden, «Mas recientes»", async () => {
    const espia = walletEspia();
    await listarMovimientosAction({}, { service: espia as unknown as IWalletService, origenes: ORIGENES_FALSOS, getActor: async () => MAESTRO });
    expect(espia.listarMovimientos).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortBy: "fecha", sortDir: "desc" }, MAESTRO);
  });

  it("R42: la descarga recibe el termino y el orden", async () => {
    const espia = walletEspia();
    await listarMovimientosCompletoAction(
      { q: "cartonera", sortDir: "asc" },
      { service: espia as unknown as IWalletService, origenes: ORIGENES_FALSOS, getActor: async () => MAESTRO },
    );
    expect(espia.listarMovimientosCompleto).toHaveBeenCalledWith({ q: "cartonera", sortBy: "fecha", sortDir: "asc" }, MAESTRO);
  });

  for (const malo of [{ sortDir: "arriba" }, { sortBy: "monto" }, { q: "ab" }]) {
    it(`R40/R24: ${JSON.stringify(malo)} ⇒ validation_error sin tocar el servicio (pagina y descarga)`, async () => {
      const espia = walletEspia();
      const deps = { service: espia as unknown as IWalletService, origenes: ORIGENES_FALSOS, getActor: async () => MAESTRO };
      expect((await listarMovimientosAction(malo, deps)).status).toBe("validation_error");
      expect((await listarMovimientosCompletoAction(malo, deps)).status).toBe("validation_error");
      expect(espia.listarMovimientos).not.toHaveBeenCalled();
      expect(espia.listarMovimientosCompleto).not.toHaveBeenCalled();
    });
  }
});

describe("463 — WalletService: el termino y el orden SOLO van al libro", () => {
  const SIN_SALDO = { haySaldoInicialVigente: async () => false };
  const vacio = { estadoDeDocumentos: async () => [] };
  const SIN_DOCUMENTOS = {
    pagosPorCuenta: vacio, aportes: vacio, cobros: vacio, ajustes: vacio, abonos: vacio, egresos: vacio,
    indemnizaciones: vacio, rechazos: vacio, pagosATienda: vacio, premios: vacio,
  };
  function repoEspia(total: number) {
    const listar = vi.fn<(f: ListarMovimientosFiltros) => Promise<{ movimientos: never[]; total: number }>>(async () => ({ movimientos: [], total }));
    const agregarPorCategoriaYTipo = vi.fn(async () => []);
    const primerDiaDeLaCaja = vi.fn(async () => null);
    const repo = { listar, agregarPorCategoriaYTipo, primerDiaDeLaCaja } as unknown as IWalletMovimientoRepository;
    return { repo, listar, agregarPorCategoriaYTipo };
  }

  it("listarMovimientos lleva `termino` y `sortDir` al repositorio", async () => {
    const { repo, listar } = repoEspia(0);
    const svc = new WalletService(repo, {} as WalletTxClient, SIN_SALDO, SIN_DOCUMENTOS);
    await svc.listarMovimientos({ page: 2, pageSize: 10, q: "Pedro", sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    expect(listar).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10, termino: "Pedro", sortDir: "asc" }));
  });

  it("sin termino ni orden, el repositorio recibe lo de siempre (sin claves nuevas)", async () => {
    const { repo, listar } = repoEspia(0);
    const svc = new WalletService(repo, {} as WalletTxClient, SIN_SALDO, SIN_DOCUMENTOS);
    await svc.listarMovimientos({ page: 1, pageSize: 20 }, MAESTRO);
    const filtros = listar.mock.calls[0]![0];
    expect(filtros).not.toHaveProperty("termino");
    expect(filtros).not.toHaveProperty("sortDir");
  });

  it("R44: la descarga con termino y orden por encima del tope ⇒ limite_excedido sin filas, como hoy", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const { repo, listar } = repoEspia(limite + 1);
    const svc = new WalletService(repo, {} as WalletTxClient, SIN_SALDO, SIN_DOCUMENTOS);
    const r = await svc.listarMovimientosCompleto({ q: "Pedro", sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    expect(r).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(listar).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: limite + 1, termino: "Pedro", sortDir: "asc" }));
  });

  it("R12: el resumen lee los agregados con los filtros de la wallet y sin termino ni orden", async () => {
    const { repo, agregarPorCategoriaYTipo } = repoEspia(0);
    const svc = new WalletService(repo, {} as WalletTxClient, SIN_SALDO, SIN_DOCUMENTOS);
    await svc.verResumenCaja({ page: 1, pageSize: 20, tipo: "ingreso" }, MAESTRO);
    const filtros = (agregarPorCategoriaYTipo.mock.calls as unknown as [Record<string, unknown>][])[0]![0];
    expect(filtros).not.toHaveProperty("termino");
    expect(filtros).not.toHaveProperty("sortDir");
  });
});

describe("463 — el estado de cuenta: termino y orden por la accion", () => {
  it("oficina: llegan al servicio; sin orden, «Mas recientes»", async () => {
    const espia = estadoEspia();
    const deps = { service: espia as unknown as IEstadoCuentaService, getActor: async () => MAESTRO };
    await verEstadoCuentaAction({ cuenta: CUENTA, q: " cobro ", sortDir: "asc" }, deps);
    await verEstadoCuentaAction({ cuenta: CUENTA }, deps);
    await verEstadoCuentaCompletoAction({ cuenta: CUENTA, q: "cobro", sortDir: "asc" }, deps);
    expect(argDe(espia.leer, 0)).toMatchObject({ q: "cobro", sortBy: "fecha", sortDir: "asc" });
    expect(argDe(espia.leer, 1)).toMatchObject({ sortBy: "fecha", sortDir: "desc" });
    expect(argDe(espia.leer, 1)).not.toHaveProperty("q");
    expect(argDe(espia.leerCompleto, 0)).toMatchObject({ q: "cobro", sortDir: "asc" });
  });

  for (const malo of [{ sortDir: "arriba" }, { sortBy: "monto" }, { q: "ab" }]) {
    it(`R40/R24: ${JSON.stringify(malo)} ⇒ validation_error sin leer (oficina, completo y /mi-wallet)`, async () => {
      const espia = estadoEspia();
      const oficina = { service: espia as unknown as IEstadoCuentaService, getActor: async () => MAESTRO };
      const tienda = { service: espia as unknown as IEstadoCuentaService, getActor: async () => TIENDA };
      expect((await verEstadoCuentaAction({ cuenta: CUENTA, ...malo }, oficina)).status).toBe("validation_error");
      expect((await verEstadoCuentaCompletoAction({ cuenta: CUENTA, ...malo }, oficina)).status).toBe("validation_error");
      expect((await verMiEstadoCuentaAction(malo, tienda)).status).toBe("validation_error");
      expect(espia.leer).not.toHaveBeenCalled();
      expect(espia.leerCompleto).not.toHaveBeenCalled();
      expect(espia.leerMiTienda).not.toHaveBeenCalled();
    });
  }
});

describe("463 — R45: la busqueda de saldos de tiendas llega al servicio", () => {
  function tiendasEspia() {
    return {
      listarSaldosTiendasPaginado: vi.fn(async () => ({ status: "ok", items: [], total: 0, page: 1, pageSize: 20 })),
      listarSaldosTiendasCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
    };
  }

  it("pagina y descarga con `busqueda`; sin ella, la descarga llama como siempre (solo el actor)", async () => {
    const espia = tiendasEspia();
    const deps = { service: espia as unknown as IWalletTiendaService, getActor: async () => MAESTRO };
    await listarSaldosTiendasPaginadoAction({ busqueda: "ferre" }, deps);
    await listarSaldosTiendasCompletoAction({ busqueda: "ferre" }, deps);
    await listarSaldosTiendasCompletoAction({}, deps);
    expect(espia.listarSaldosTiendasPaginado).toHaveBeenCalledWith(expect.objectContaining({ busqueda: "ferre", page: 1 }), MAESTRO);
    expect(espia.listarSaldosTiendasCompleto).toHaveBeenNthCalledWith(1, MAESTRO, { busqueda: "ferre" });
    expect(espia.listarSaldosTiendasCompleto).toHaveBeenNthCalledWith(2, MAESTRO);
  });
});
