import { describe, it, expect, vi, afterEach } from "vitest";

import { CajaKardexService, type SaldosDeCaja } from "@/lib/services/LibroKardexService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { CabeceraDeCierre, FiltroAportesEnLote, OrdenAporteEnLoteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { EXCEL_MAX_FILAS_DATOS, descargaConfig } from "@/lib/config/descarga";

/**
 * Ficha 470 (T1.2, R1/R4) — el caso medido en produccion: «Movimientos y detalle por guía» de la caja con
 * un detalle de 14.153 filas devolvia «El detalle por guía tendría 14153 filas y la descarga admite hasta
 * 5000». Con el tope = limite de Excel, el MISMO conjunto devuelve `ok` con las dos hojas.
 *
 * Se usa el `DetalleEnLoteService` REAL (es donde vive el tope del detalle) con repositorios dobles, y el
 * `CajaKardexService` real encima: el camino entero de `libroCajaKardexConDetalleAction` menos la base.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const FILAS_DEL_CASO = 14_153;
const APORTE = 1000;
const TOTAL = `${FILAS_DEL_CASO * APORTE}.00`;

function orden(n: number): OrdenAporteEnLoteRow {
  return {
    cierreId: "c-1",
    ordenId: `o-${n}`,
    numGuia: 100_000 + n,
    numRemision: `REM-${n}`,
    destinatario: `Dest ${n}`,
    tiendaNombre: "Tienda A",
    orden: { esCentral: false, esZonaEspecial: false, montoCobrar: "1000.00", cobraComision: false, tarifa: null },
    gestiones: [{ resultado: "entregado", montoRecibido: "1000.00", pagoMensajero: null, indemnizacion: null }],
  };
}

const MOVIMIENTO = {
  id: "mov-cod",
  tipo: "ingreso",
  categoria: "ingreso_cod_recaudado",
  monto: TOTAL,
  origenTipo: "cierre_dia",
  origenId: "c-1",
  descripcion: null,
  registradoPor: null,
  fechaMovimiento: "2026-09-10T18:00:00.000Z",
  dueno: "terceros",
  documento: null,
} as WalletMovimientoDTO;

function montar() {
  const filas = Array.from({ length: FILAS_DEL_CASO }, (_, i) => orden(i + 1));
  const contarAportesPorCierre = vi.fn(async (f: FiltroAportesEnLote) => {
    const m = new Map<string, number>();
    for (const fila of filas) if (f.cierreIds.includes(fila.cierreId)) m.set(fila.cierreId, (m.get(fila.cierreId) ?? 0) + 1);
    return m;
  });
  const listarAportesDeCierres = vi.fn(async (f: FiltroAportesEnLote) => filas.filter((x) => f.cierreIds.includes(x.cierreId)));
  const cabecerasDeCierres = vi.fn(
    async (ids: readonly string[]) =>
      new Map<string, CabeceraDeCierre>(ids.map((id) => [id, { fecha: "2026-09-10T18:00:00.000Z", mensajeroNombre: "Mario" }])),
  );
  const detalle = new DetalleEnLoteService(
    { contarAportesPorCierre, listarAportesDeCierres, cabecerasDeCierres },
    { listarPorIdsDeTienda: vi.fn(async () => []) },
    { listarPorIdsDeMensajero: vi.fn(async () => []) },
  );
  const listarMovimientosCompleto = vi.fn<IWalletService["listarMovimientosCompleto"]>(async () => ({
    status: "ok",
    items: [MOVIMIENTO],
    total: 1,
  }));
  const agregarPorCategoriaYTipo = vi.fn<SaldosDeCaja["agregarPorCategoriaYTipo"]>(async () => [
    { categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: TOTAL },
  ]);
  const saldosTrasMovimientos = vi.fn<SaldosDeCaja["saldosTrasMovimientos"]>(async () => new Map([[MOVIMIENTO.id, TOTAL]]));
  const servicio = new CajaKardexService({ listarMovimientosCompleto }, { agregarPorCategoriaYTipo, saldosTrasMovimientos }, detalle);
  return { servicio, listarAportesDeCierres };
}

const TOPE_REAL = descargaConfig.MAX_FILAS;
afterEach(() => {
  descargaConfig.MAX_FILAS = TOPE_REAL;
});

describe("470 — R4/R1: el detalle por guia de la caja ya no se corta en 5000", () => {
  it("el tope del servicio es el limite de Excel", () => {
    expect(descargaConfig.MAX_FILAS).toBe(EXCEL_MAX_FILAS_DATOS);
  });

  it("R4: 14.153 filas de detalle devuelven `ok` con las dos hojas, no `limite_excedido`", async () => {
    const m = montar();
    const r = await m.servicio.kardexConDetalle({}, MAESTRO);
    if (r.status !== "ok") throw new Error(`se esperaba ok y llego ${JSON.stringify(r)}`);
    // Hoja 1: el movimiento; hoja 2: TODAS las guias, sin una de menos.
    expect(r.items).toHaveLength(1);
    expect(r.kardex.filas).toHaveLength(1);
    const guias = r.porGuia.bloques.map((b) => b.guia);
    expect(guias).toHaveLength(FILAS_DEL_CASO);
    expect(guias[0]).toBe("100001");
    expect(guias[FILAS_DEL_CASO - 1]).toBe(String(100_000 + FILAS_DEL_CASO));
    // La invariante de la 468 se sigue cumpliendo con el conjunto grande.
    expect(r.porGuia.totalGeneral).toEqual(r.kardex.totales);
  });

  it("mutacion del tope: con MAX_FILAS = 10 el MISMO conjunto devuelve `limite_excedido` del detalle sin leer ordenes", async () => {
    descargaConfig.MAX_FILAS = 10;
    const m = montar();
    expect(await m.servicio.kardexConDetalle({}, MAESTRO)).toEqual({
      status: "limite_excedido",
      hoja: "detalle",
      total: FILAS_DEL_CASO,
      limite: 10,
    });
    expect(m.listarAportesDeCierres).not.toHaveBeenCalled();
  });
});
