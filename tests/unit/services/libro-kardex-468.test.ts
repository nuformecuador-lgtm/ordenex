import { describe, it, expect, vi } from "vitest";

import { CajaKardexService, CuentaKardexService, type SaldosDeCaja } from "@/lib/services/LibroKardexService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IDetalleEnLoteService } from "@/lib/interfaces/services/IDetalleEnLoteService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { AgregadoCajaRow, WalletMovimientoDTO } from "@/lib/types/wallet";

/**
 * Ficha 468 (T9, design §4.3) — los orquestadores del kardex con DOBLES: el orden forzado (R7), que «Solo
 * los movimientos» pide conteos y no el detalle (R61), los cortes sin leer (R25, topes, rol) y la atadura
 * del saldo corrido de la caja con la tarjeta (R12/R15). La invariante contra la base vive en
 * `tests/integration/db/468/libro-kardex-468.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function mov(id: string, over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id,
    tipo: "ingreso",
    categoria: "ingreso_cod_recaudado",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-09-10T18:00:00.000Z",
    dueno: "terceros",
    documento: null,
    ...over,
  } as WalletMovimientoDTO;
}

function montarCaja(opciones: {
  items?: WalletMovimientoDTO[];
  completo?: Awaited<ReturnType<IWalletService["listarMovimientosCompleto"]>>;
  saldos?: Record<string, string>;
  antes?: AgregadoCajaRow[];
  hastaFin?: AgregadoCajaRow[];
}) {
  const items = opciones.items ?? [];
  const listarMovimientosCompleto = vi.fn<IWalletService["listarMovimientosCompleto"]>(
    async () => opciones.completo ?? { status: "ok", items, total: items.length },
  );
  const agregarPorCategoriaYTipo = vi.fn<SaldosDeCaja["agregarPorCategoriaYTipo"]>(async (f) =>
    f.hasta !== undefined && f.hasta.getTime() < Date.UTC(2026, 8, 5) ? (opciones.antes ?? []) : (opciones.hastaFin ?? []),
  );
  const saldosTrasMovimientos = vi.fn<SaldosDeCaja["saldosTrasMovimientos"]>(
    async () => new Map(Object.entries(opciones.saldos ?? {})),
  );
  const contar = vi.fn<IDetalleEnLoteService["contar"]>(async (input) => ({
    status: "ok",
    ordenes: input.superficie === "caja" ? input.movimientos.map(() => 2) : [],
  }));
  const detallar = vi.fn<IDetalleEnLoteService["detallar"]>(async () => ({ status: "ok", detalle: [] }));
  const servicio = new CajaKardexService({ listarMovimientosCompleto }, { agregarPorCategoriaYTipo, saldosTrasMovimientos }, { contar, detallar });
  return { servicio, listarMovimientosCompleto, agregarPorCategoriaYTipo, saldosTrasMovimientos, contar, detallar };
}

const DESDE = new Date("2026-09-01T06:00:00.000Z");
const HASTA = new Date("2026-09-30T06:00:00.000Z");

describe("468 — caja: el kardex y su orden", () => {
  it("R7: el archivo SIEMPRE se lee en orden cronologico ascendente, aunque la pantalla pida «Más recientes»", async () => {
    const m = montarCaja({});
    await m.servicio.kardex({ sortBy: "fecha", sortDir: "desc", q: "abc" }, MAESTRO);
    expect(m.listarMovimientosCompleto).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "fecha", sortDir: "asc", q: "abc" }),
      MAESTRO,
    );
  });

  it("R12/R14/R61: saldo inicial (antes del periodo), final, saldo por fila y conteos — sin leer ninguna orden", async () => {
    const items = [mov("a", { monto: "1000.00" }), mov("b", { categoria: "ingreso_flete", monto: "150.00", dueno: "propio" })];
    const m = montarCaja({
      items,
      antes: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "500.00" }],
      hastaFin: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "1500.00" }, { categoria: "ingreso_flete", tipo: "ingreso", total: "150.00" }],
      saldos: { a: "1500.00", b: "1500.00" },
    });
    const r = await m.servicio.kardex({ desde: DESDE, hasta: HASTA }, MAESTRO);
    if (r.status !== "ok") throw new Error(r.status);
    expect(m.agregarPorCategoriaYTipo).toHaveBeenCalledWith({ hasta: DESDE });
    expect(m.agregarPorCategoriaYTipo).toHaveBeenCalledWith({ hasta: HASTA });
    expect(m.saldosTrasMovimientos.mock.calls[0][0]).toEqual(["a", "b"]);
    expect(m.saldosTrasMovimientos.mock.calls[0][2]).toBe(HASTA);
    expect(r.kardex).toEqual({
      saldoInicial: "500.00",
      saldoFinal: "1500.00",
      totales: { entra: "1000.00", sale: "0.00", cobradoATiendas: "150.00" },
      conOtrosFiltros: false,
      filas: [
        { monto: { columna: "entra", monto: "1000.00" }, saldo: "1500.00", ordenes: 2 },
        { monto: { columna: "cobrado_a_tiendas", monto: "150.00" }, saldo: "1500.00", ordenes: 2 },
      ],
    });
    expect(m.contar).toHaveBeenCalledTimes(1);
    expect(m.detallar).not.toHaveBeenCalled(); // R61
  });

  it("R14: sin fecha de inicio el saldo inicial es 0,00 y no se lee lo anterior", async () => {
    const m = montarCaja({});
    const r = await m.servicio.kardex({}, MAESTRO);
    expect(r.status === "ok" && r.kardex.saldoInicial).toBe("0.00");
    expect(m.agregarPorCategoriaYTipo).toHaveBeenCalledTimes(1);
    expect(m.agregarPorCategoriaYTipo).toHaveBeenCalledWith({});
  });

  it("R12/R15: si el saldo corrido no casa con la tarjeta (sin otros filtros), la descarga FALLA ruidosa", async () => {
    const m = montarCaja({
      items: [mov("a", { monto: "1000.00" })],
      hastaFin: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "1000.00" }],
      saldos: { a: "999.99" },
    });
    await expect(m.servicio.kardex({}, MAESTRO)).rejects.toThrow(/libro de caja/);
    // Se repitio la lectura entera (3 veces) antes de rendirse: la divergencia era real.
    expect(m.listarMovimientosCompleto).toHaveBeenCalledTimes(3);
  });

  it("R15: un descuadre PASAJERO (un movimiento entre dos lecturas) se resuelve repitiendo la lectura", async () => {
    const m = montarCaja({
      items: [mov("a", { monto: "1000.00" })],
      hastaFin: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "1000.00" }],
      saldos: { a: "1000.00" },
    });
    m.saldosTrasMovimientos.mockResolvedValueOnce(new Map([["a", "1250.00"]])); // la primera vio uno de mas
    const r = await m.servicio.kardex({}, MAESTRO);
    expect(r.status === "ok" && r.kardex.filas[0].saldo).toBe("1000.00");
    expect(m.listarMovimientosCompleto).toHaveBeenCalledTimes(2);
  });

  it("R16: con otros filtros (concepto) no se afirma: el saldo de la fila es el de la caja entera", async () => {
    const m = montarCaja({
      items: [mov("a", { monto: "1000.00" })],
      hastaFin: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "9000.00" }],
      saldos: { a: "4000.00" },
    });
    const r = await m.servicio.kardex({ categoria: "ingreso_cod_recaudado" }, MAESTRO);
    expect(r.status === "ok" && r.kardex.conOtrosFiltros).toBe(true);
    expect(r.status === "ok" && r.kardex.filas[0].saldo).toBe("4000.00");
  });

  it("topes y rol: limite de la hoja de movimientos (con `hoja`) y forbidden SIN leer saldos ni el lote", async () => {
    for (const completo of [{ status: "limite_excedido" as const, total: 9, limite: 5 }, { status: "forbidden" as const }]) {
      const m = montarCaja({ completo });
      const r = await m.servicio.kardexConDetalle({}, MAESTRO);
      expect(r).toEqual(completo.status === "forbidden" ? completo : { ...completo, hoja: "movimientos" });
      expect(m.agregarPorCategoriaYTipo).not.toHaveBeenCalled();
      expect(m.saldosTrasMovimientos).not.toHaveBeenCalled();
      expect(m.detallar).not.toHaveBeenCalled();
    }
  });

  it("R26/R53/R57: con detalle, los conteos salen de la hoja 2 y la hoja 1 es la misma; el limite del detalle lleva `hoja`", async () => {
    const items = [mov("a", { monto: "1000.00" })];
    const base = {
      items,
      hastaFin: [{ categoria: "ingreso_cod_recaudado" as const, tipo: "ingreso" as const, total: "1000.00" }],
      saldos: { a: "1000.00" },
    };
    const m = montarCaja(base);
    m.detallar.mockResolvedValueOnce({
      status: "ok",
      detalle: [
        {
          movimientoId: "a",
          modo: "ordenes",
          cierre: { fecha: "2026-09-10T18:00:00.000Z", mensajeroNombre: "Mario" },
          ordenes: [
            { clave: "o1", guia: "501", remision: "R1", destinatario: "Ana", tiendaNombre: "T", resultados: ["entregado"], aporte: "600.00" },
            { clave: "o2", guia: "502", remision: "R2", destinatario: "Beto", tiendaNombre: "T", resultados: ["entregado"], aporte: "400.00" },
          ],
          suma: "1000.00",
          cuadra: true,
        },
      ],
    });
    const con = await m.servicio.kardexConDetalle({}, MAESTRO);
    const sin = await m.servicio.kardex({}, MAESTRO);
    if (con.status !== "ok" || sin.status !== "ok") throw new Error("se esperaba ok");
    expect(con.kardex).toEqual(sin.kardex); // R57 (el doble de contar tambien dice 2)
    expect(con.porGuia.totalGeneral).toEqual(con.kardex.totales); // R45
    expect(con.porGuia.bloques.map((b) => b.guia)).toEqual(["501", "502"]);

    m.detallar.mockResolvedValueOnce({ status: "limite_excedido", total: 7, limite: 5 });
    expect(await m.servicio.kardexConDetalle({}, MAESTRO)).toEqual({ status: "limite_excedido", hoja: "detalle", total: 7, limite: 5 });
  });
});

function filaCuenta(id: string, over: Partial<FilaEstadoCuentaDTO> = {}): FilaEstadoCuentaDTO {
  return {
    ref: { libro: "tienda", movimientoId: id },
    consolidacionId: null,
    fecha: "2026-09-10",
    categoria: "cod_recaudado",
    origenTipo: "cierre_dia",
    origen: null,
    pago: null,
    descripcion: null,
    registro: { nombre: null, automatico: null },
    cargo: null,
    abono: "100.00",
    saldoCorrido: "100.00",
    chip: "cierre" as FilaEstadoCuentaDTO["chip"],
    anulacion: null,
    esContraAsiento: false,
    tieneComprobante: false,
    anulable: false,
    naceDeUnCierre: true,
    ...over,
  };
}

function estado(tipo: "tienda" | "mensajero" | "bodega", filas: FilaEstadoCuentaDTO[]): EstadoCuentaDTO {
  return {
    cuenta: { tipo, id: `cuenta-${tipo}`, nombre: "X" },
    saldoActual: "100.00",
    signo: "positivo",
    sentido: "ordenex_debe",
    saldoInicial: "0.00",
    abonos: "100.00",
    cargos: "0.00",
    saldoFinal: filas.length === 0 ? "0.00" : "100.00",
    resumen: null,
    filas,
    total: filas.length,
    page: 1,
    pageSize: filas.length,
  };
}

function montarCuenta(e: EstadoCuentaDTO) {
  const leerCompleto = vi.fn<IEstadoCuentaService["leerCompleto"]>(async () => ({ status: "ok", estado: e }));
  const leerMiTiendaCompleto = vi.fn<IEstadoCuentaService["leerMiTiendaCompleto"]>(async () => ({ status: "ok", estado: e }));
  const contar = vi.fn<IDetalleEnLoteService["contar"]>(async (input) => ({
    status: "ok",
    ordenes: "movimientoIds" in input ? input.movimientoIds.map(() => 1) : [],
  }));
  const detallar = vi.fn<IDetalleEnLoteService["detallar"]>(async (input) => ({
    status: "ok",
    detalle: ("movimientoIds" in input ? input.movimientoIds : []).map((id) => ({
      movimientoId: id,
      modo: "sin_reparto" as const,
      motivo: "no_nace_de_un_cierre" as const,
    })),
  }));
  const servicio = new CuentaKardexService({ leerCompleto, leerMiTiendaCompleto }, { contar, detallar });
  return { servicio, leerCompleto, leerMiTiendaCompleto, contar, detallar };
}

describe("468 — estado de cuenta: el kardex y su orquestacion", () => {
  it("R25: la bodega con detalle es validation_error SIN leer nada; sin detalle no pide conteos", async () => {
    const e = estado("bodega", [filaCuenta("x", { ref: null, cargo: "100.00", abono: null })]);
    const m = montarCuenta(e);
    const conDetalle = await m.servicio.kardexConDetalle({ cuenta: { tipo: "bodega", id: "z" }, sortBy: "fecha", sortDir: "desc" }, MAESTRO);
    expect(conDetalle.status).toBe("validation_error");
    expect(m.leerCompleto).not.toHaveBeenCalled();
    const sin = await m.servicio.kardex({ cuenta: { tipo: "bodega", id: "z" }, sortBy: "fecha", sortDir: "desc" }, MAESTRO);
    expect(sin.status === "ok" && sin.kardex.filas).toEqual([{ monto: { columna: "entra", monto: "100.00" }, saldo: "100.00", ordenes: null }]);
    expect(m.contar).not.toHaveBeenCalled();
  });

  it("R7: la oficina y /mi-wallet leen en orden ascendente aunque la pantalla diga «Más recientes»", async () => {
    const m = montarCuenta(estado("tienda", [filaCuenta("a")]));
    await m.servicio.kardex({ cuenta: { tipo: "tienda", id: "t" }, sortBy: "fecha", sortDir: "desc" }, MAESTRO);
    await m.servicio.miKardex({ sortBy: "fecha", sortDir: "desc" }, { usuarioId: "t", rol: "adminTienda" });
    expect(m.leerCompleto.mock.calls[0][0]).toMatchObject({ sortBy: "fecha", sortDir: "asc" });
    expect(m.leerMiTiendaCompleto.mock.calls[0][0]).toMatchObject({ sortBy: "fecha", sortDir: "asc" });
  });

  it("R31/R55: el mensajero con detalle pide el lote del MENSAJERO de la cuenta leida; la tienda, el de SU tienda", async () => {
    const msj = montarCuenta(estado("mensajero", [filaCuenta("d", { ref: { libro: "mensajero", movimientoId: "d" } })]));
    const r = await msj.servicio.kardexConDetalle({ cuenta: { tipo: "mensajero", id: "otra" }, sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(msj.detallar).toHaveBeenCalledWith({ superficie: "mensajero_oficina", mensajeroId: "cuenta-mensajero", movimientoIds: ["d"] }, MAESTRO);

    const tienda = montarCuenta(estado("tienda", [filaCuenta("a")]));
    await tienda.servicio.kardex({ cuenta: { tipo: "tienda", id: "t" }, sortBy: "fecha", sortDir: "asc" }, MAESTRO);
    expect(tienda.contar).toHaveBeenCalledWith({ superficie: "tienda_oficina", tiendaId: "cuenta-tienda", movimientoIds: ["a"] }, MAESTRO);
    expect(tienda.detallar).not.toHaveBeenCalled(); // R61
  });

  it("R16: chip, cierre o termino marcan `conOtrosFiltros`; el periodo solo, no", async () => {
    const m = montarCuenta(estado("tienda", [filaCuenta("a")]));
    const base = { cuenta: { tipo: "tienda" as const, id: "t" }, sortBy: "fecha" as const, sortDir: "asc" as const };
    const sinFiltros = await m.servicio.kardex({ ...base, desde: "2026-09-01" }, MAESTRO);
    const conChip = await m.servicio.kardex({ ...base, chip: "cierre" as never }, MAESTRO);
    const conTermino = await m.servicio.kardex({ ...base, q: "flete" }, MAESTRO);
    expect([sinFiltros, conChip, conTermino].map((r) => r.status === "ok" && r.kardex.conOtrosFiltros)).toEqual([false, true, true]);
  });

  it("R45: con detalle, el TOTAL GENERAL = el total de la hoja 1", async () => {
    const m = montarCuenta(estado("tienda", [filaCuenta("a")]));
    const r = await m.servicio.miKardexConDetalle({ sortBy: "fecha", sortDir: "asc" }, { usuarioId: "t", rol: "adminTienda" });
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.porGuia.totalGeneral).toEqual(r.kardex.totales);
    expect(r.porGuia.sinGuia).toHaveLength(1);
  });

  it("468 (antes 464 T6): /mi-wallet pide el lote de la superficie mi_wallet SIN tienda en la entrada (sale del actor)", async () => {
    const dos = estado("tienda", [filaCuenta("a"), filaCuenta("b", { saldoCorrido: "200.00" })]);
    const m = montarCuenta({ ...dos, abonos: "200.00", saldoFinal: "200.00" });
    const tienda = { usuarioId: "t", rol: "adminTienda" as const };
    await m.servicio.miKardexConDetalle({ sortBy: "fecha", sortDir: "asc" }, tienda);
    expect(m.detallar).toHaveBeenCalledWith({ superficie: "mi_wallet", movimientoIds: ["a", "b"] }, tienda);
    await m.servicio.miKardex({ sortBy: "fecha", sortDir: "asc" }, tienda);
    expect(m.contar).toHaveBeenCalledWith({ superficie: "mi_wallet", movimientoIds: ["a", "b"] }, tienda);
  });

  it("468 (antes 464 R38): el tope del estado de cuenta pasa con hoja «movimientos» y NO se pide el lote; no_encontrado tal cual", async () => {
    const m = montarCuenta(estado("tienda", [filaCuenta("a")]));
    m.leerCompleto.mockResolvedValueOnce({ status: "limite_excedido", total: 9, limite: 5 });
    expect(await m.servicio.kardexConDetalle({ cuenta: { tipo: "tienda", id: "t" }, sortBy: "fecha", sortDir: "asc" }, MAESTRO)).toEqual({
      status: "limite_excedido",
      hoja: "movimientos",
      total: 9,
      limite: 5,
    });
    m.leerCompleto.mockResolvedValueOnce({ status: "no_encontrado" });
    expect(await m.servicio.kardex({ cuenta: { tipo: "tienda", id: "t" }, sortBy: "fecha", sortDir: "asc" }, MAESTRO)).toEqual({
      status: "no_encontrado",
    });
    expect(m.detallar).not.toHaveBeenCalled();
    expect(m.contar).not.toHaveBeenCalled();
  });
});
