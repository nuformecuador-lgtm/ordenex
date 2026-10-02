import { describe, it, expect, vi } from "vitest";

import type { IEstadoCuentaRepository, VentanaDeLibro } from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import type { IWalletMovimientoRepository, ListarMovimientosFiltros, WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { OrdenAporteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { BusquedaResuelta } from "@/lib/types/busqueda-por-guia";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { EstadoCuentaService } from "@/lib/services/EstadoCuentaService";
import { WalletService } from "@/lib/services/WalletService";

// FICHA 469 / T8 y T10 — los servicios del libro y del detalle con DOBLES: que el termino se resuelva en
// el servidor y viaje como `termino` O como `porGuia` (nunca los dos), que `modoBusqueda` vuelva bien, que
// las cifras no lo vean, que la bodega no se resuelva y que el detalle identifique con SU `tiendaId`.
// Lo que el motor selecciona se mide contra Postgres en `tests/integration/db/busqueda-por-guia-469.test.ts`.

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };
const PARES = [{ origenTipo: "cierre_dia" as const, origenId: "c-1", categoria: "ingreso_flete" }];

function busquedaQueDa(r: (termino: string) => BusquedaResuelta) {
  return { resolver: vi.fn(async (f: { termino: string }) => r(f.termino)) };
}
const GUIA = (t: string): BusquedaResuelta => ({ modo: "guia", termino: t, ordenIds: ["o-a"], pares: PARES });
const TEXTO = (t: string): BusquedaResuelta => ({ modo: "texto", termino: t });

describe("469 — WalletService (caja)", () => {
  const SIN_SALDO = { haySaldoInicialVigente: async () => false };
  const vacio = { estadoDeDocumentos: async () => [] };
  const SIN_DOCUMENTOS = {
    pagosPorCuenta: vacio, aportes: vacio, cobros: vacio, ajustes: vacio, abonos: vacio, egresos: vacio,
    indemnizaciones: vacio, rechazos: vacio, pagosATienda: vacio, premios: vacio,
  };
  function montar(busqueda: ReturnType<typeof busquedaQueDa>) {
    const listar = vi.fn<(f: ListarMovimientosFiltros) => Promise<{ movimientos: never[]; total: number }>>(async () => ({ movimientos: [], total: 0 }));
    const agregarPorCategoriaYTipo = vi.fn(async () => []);
    const primerDiaDeLaCaja = vi.fn(async () => null);
    const repo = { listar, agregarPorCategoriaYTipo, primerDiaDeLaCaja } as unknown as IWalletMovimientoRepository;
    const svc = new WalletService(repo, {} as WalletTxClient, SIN_SALDO, SIN_DOCUMENTOS, undefined, busqueda);
    return { svc, listar, agregarPorCategoriaYTipo };
  }

  it("R2/R10/R20/R33: termino que identifica una orden ⇒ `porGuia` al repositorio, SIN `termino`, con su orden; modo «guia»", async () => {
    const b = busquedaQueDa(GUIA);
    const m = montar(b);
    const r = await m.svc.listarMovimientos({ page: 1, pageSize: 20, q: "46803", sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.data.modoBusqueda).toBe("guia");
    expect(b.resolver).toHaveBeenCalledWith({ termino: "46803", superficie: { tipo: "caja" } });
    const filtros = m.listar.mock.calls[0]![0];
    expect(filtros.porGuia).toEqual(PARES);
    expect(filtros).not.toHaveProperty("termino");
    expect(filtros.sortDir).toBe("asc");
  });

  it("R6: termino que no identifica nada ⇒ `termino` como en la 463 y modo «texto»", async () => {
    const m = montar(busquedaQueDa(TEXTO));
    const r = await m.svc.listarMovimientos({ page: 1, pageSize: 20, q: "Pedro" }, MAESTRO);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.data.modoBusqueda).toBe("texto");
    const filtros = m.listar.mock.calls[0]![0];
    expect(filtros.termino).toBe("Pedro");
    expect(filtros).not.toHaveProperty("porGuia");
  });

  it("R23: sin termino no se resuelve nada y la respuesta no lleva `modoBusqueda`", async () => {
    const b = busquedaQueDa(GUIA);
    const m = montar(b);
    const r = await m.svc.listarMovimientos({ page: 1, pageSize: 20 }, MAESTRO);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.data).not.toHaveProperty("modoBusqueda");
    expect(b.resolver).not.toHaveBeenCalled();
  });

  it("R30: la descarga resuelve IGUAL que la pantalla (mismos `porGuia`)", async () => {
    const m = montar(busquedaQueDa(GUIA));
    await m.svc.listarMovimientosCompleto({ q: "46803", sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    expect(m.listar.mock.calls[0]![0].porGuia).toEqual(PARES);
  });

  it("R18: el resumen de la caja no resuelve la busqueda ni la recibe", async () => {
    const b = busquedaQueDa(GUIA);
    const m = montar(b);
    await m.svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    expect(b.resolver).not.toHaveBeenCalled();
    for (const [f] of m.agregarPorCategoriaYTipo.mock.calls as unknown as Array<[object]>) expect(f).not.toHaveProperty("porGuia");
  });

  it("R33: el forbidden no llega a resolver nada (el guard va antes)", async () => {
    const b = busquedaQueDa(GUIA);
    const m = montar(b);
    expect((await m.svc.listarMovimientos({ page: 1, pageSize: 20, q: "46803" }, TIENDA)).status).toBe("forbidden");
    expect(b.resolver).not.toHaveBeenCalled();
  });
});

describe("469 — EstadoCuentaService", () => {
  it("R36: en la bodega satelite el termino NO se resuelve: viaja como texto y el modo es «texto»", async () => {
    const b = busquedaQueDa(GUIA);
    const paginaDeBodega = vi.fn(async (_z: string, _v: VentanaDeLibro) => ({ filas: [], total: 0 }));
    const repo = {
      nombreDeCuenta: async () => "Bodega Norte",
      enLecturaConsistente: async <T>(fn: (r: IEstadoCuentaRepository) => Promise<T>) => fn(repo as unknown as IEstadoCuentaRepository),
      paginaDeBodega,
      totalesDeBodega: async () => ({ efectivo: "0.00", recibido: "0.00" }),
      periodoDeBodega: async () => [],
    };
    const svc = new EstadoCuentaService(
      repo as unknown as IEstadoCuentaRepository,
      { estadoPorGestion: async () => new Map() } as never,
      { resolver: async () => [] } as never,
      b,
    );
    const r = await svc.leer(
      { cuenta: { tipo: "bodega", id: "00000000-0000-4000-8000-0000000000cc" }, page: 1, pageSize: 20, q: "46803", sortBy: "fecha", sortDir: "desc" },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.estado.modoBusqueda).toBe("texto");
    expect(b.resolver).not.toHaveBeenCalled();
    const v = paginaDeBodega.mock.calls[0]![1];
    expect(v.termino).toBe("46803");
    expect(v).not.toHaveProperty("porGuia");
  });
});

describe("469 — DetalleMovimientoService con `resaltar`", () => {
  const MOV = "11111111-2222-4333-8444-555555555555";
  function filaDe(ordenId: string, numGuia: number): OrdenAporteRow {
    return {
      ordenId,
      numGuia,
      numRemision: `REM-${ordenId}`,
      destinatario: "Ana",
      tiendaNombre: "Tienda A",
      orden: {
        esCentral: false,
        esZonaEspecial: false,
        montoCobrar: null,
        cobraComision: false,
        tarifa: {
          valorFlete: "1000.00", valorFleteGam: "1500.00", valorFleteDevuelto: "400.00", valorFleteDevueltoGam: "600.00",
          comisionCod: "3.50", ivaFlete: "13.00", ivaComisionCod: "13.00", tarifaEspecial: null, tarifaEspecialDevuelta: null,
        },
      },
      gestiones: [{ resultado: "entregado", montoRecibido: null, pagoMensajero: null, indemnizacion: null }],
    };
  }
  function montar(identificadas: string[], movimientoDeTienda: Partial<WalletTiendaMovimientoDTO> = {}) {
    const identificar = vi.fn(async (_f: { termino: string; tiendaId?: string }) => identificadas);
    const listarOrdenesQueAportan = vi.fn(async (f: { ordenIds?: readonly string[] }) =>
      f.ordenIds === undefined
        ? { items: [filaDe("o-1", 501), filaDe("o-a", 502)], total: 9 }
        : { items: [filaDe("o-a", 502)], total: 1 },
    );
    const service = new DetalleMovimientoService(
      { obtenerPorId: async () => null },
      {
        obtenerPorIdDeTienda: async () =>
          ({ id: MOV, categoria: "flete", monto: "2000.00", origenTipo: "cierre_dia", origenId: "c-1", ...movimientoDeTienda }) as WalletTiendaMovimientoDTO,
      },
      {
        listarOrdenesQueAportan,
        contarOrdenesDelCierre: async () => 12,
        obtenerCabeceraDeCierre: async () => ({ fecha: "2026-08-20T18:30:00.000Z", mensajeroNombre: "K" }),
      },
      { movimientoDeMensajero: async () => null },
      { identificar },
    );
    return { service, identificar, listarOrdenesQueAportan };
  }

  it("R29: en /mi-wallet identifica con la tienda del ACTOR; R25/R26/R27: destacadas con el mismo aporte y solo ella resaltada", async () => {
    const m = montar(["o-a"]);
    const r = await m.service.verDetalleDeMiMovimiento({ movimientoId: MOV, page: 1, pageSize: 25, resaltar: "502" }, TIENDA);
    if (r.status !== "ok") throw new Error(r.status);
    expect(m.identificar).toHaveBeenCalledWith({ termino: "502", tiendaId: TIENDA.usuarioId });
    // La consulta de las destacadas es la MISMA del detalle, acotada a las identificadas.
    const conIds = m.listarOrdenesQueAportan.mock.calls.map((c) => c[0]).find((f) => f.ordenIds !== undefined);
    expect(conIds).toMatchObject({ ordenIds: ["o-a"], tiendaId: TIENDA.usuarioId, rango: { skip: 0, take: 1 } });
    expect(r.data.destacadas.map((d) => d.ordenId)).toEqual(["o-a"]);
    const enLista = r.data.ordenes.find((o) => o.ordenId === "o-a");
    expect(r.data.destacadas[0].aporte).toBe(enLista?.aporte);
    expect(r.data.ordenes.map((o) => [o.ordenId, o.resaltada])).toEqual([
      ["o-1", false],
      ["o-a", true],
    ]);
  });

  it("R28: sin `resaltar` no se identifica nada, destacadas vacio y nada resaltado", async () => {
    const m = montar(["o-a"]);
    const r = await m.service.verDetalleDeMiMovimiento({ movimientoId: MOV, page: 1, pageSize: 25 }, TIENDA);
    if (r.status !== "ok") throw new Error(r.status);
    expect(m.identificar).not.toHaveBeenCalled();
    expect(m.listarOrdenesQueAportan).toHaveBeenCalledTimes(1);
    expect(r.data.destacadas).toEqual([]);
    expect(r.data.ordenes.every((o) => o.resaltada === false)).toBe(true);
  });

  it("R28: un termino que no identifica nada en ese alcance deja el detalle como sin busqueda", async () => {
    const m = montar([]);
    const r = await m.service.verDetalleDeMiMovimiento({ movimientoId: MOV, page: 1, pageSize: 25, resaltar: "999" }, TIENDA);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.data.destacadas).toEqual([]);
    expect(r.data.ordenes.every((o) => o.resaltada === false)).toBe(true);
    expect(m.listarOrdenesQueAportan).toHaveBeenCalledTimes(1);
  });

  it("un movimiento sin reparto sigue `sin_reparto` y no identifica nada", async () => {
    const m = montar(["o-a"], { categoria: "cobro_manual", origenTipo: "manual", origenId: null });
    const r = await m.service.verDetalleDeMiMovimiento({ movimientoId: MOV, page: 1, pageSize: 25, resaltar: "502" }, TIENDA);
    expect(r).toEqual({ status: "sin_reparto", motivo: "no_nace_de_un_cierre" });
    expect(m.identificar).not.toHaveBeenCalled();
  });
});
