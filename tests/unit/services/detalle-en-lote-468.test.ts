import { describe, it, expect, vi, afterEach } from "vitest";

import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CabeceraDeCierre, FiltroAportesEnLote, OrdenAporteEnLoteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { MovimientoDeMensajeroEnLoteRow } from "@/lib/interfaces/repositories/IMovimientosMensajeroEnLoteRepository";
import { descargaConfig } from "@/lib/config/descarga";
import { CRITERIO_PAGO_MENSAJERO } from "@/lib/utils/aporte-por-orden";

/**
 * Ficha 468 (T7, design §4.1/§7.3) — el lote con la superficie del MENSAJERO y el metodo `contar`, con
 * DOBLES. El `WHERE` real (pago > 0, correlacion con el cierre) y el diferencial lote = fila se miden
 * contra Postgres en `tests/integration/db/468/aportes-snapshot-468.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_TIENDA: Actor = { usuarioId: "t-A", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m-1", rol: "mensajero" };

function orden(cierreId: string, n: number, pago: string, tienda = "Tienda A"): OrdenAporteEnLoteRow {
  return {
    cierreId,
    ordenId: `o-${n}`,
    numGuia: 500 + n,
    numRemision: `REM-${n}`,
    destinatario: `Dest ${n}`,
    tiendaNombre: tienda,
    orden: { esCentral: false, esZonaEspecial: false, montoCobrar: null, cobraComision: false, tarifa: null },
    gestiones: [{ resultado: "entregado", montoRecibido: null, pagoMensajero: pago, indemnizacion: null }],
  };
}

function movMensajero(over: Partial<MovimientoDeMensajeroEnLoteRow> & { id: string }): MovimientoDeMensajeroEnLoteRow {
  return { categoria: "pago_devengado", monto: "1500.00", origenTipo: "cierre_dia", origenId: "c-1", ...over };
}

function montar(opciones: { filas?: OrdenAporteEnLoteRow[]; movimientos?: MovimientoDeMensajeroEnLoteRow[] } = {}) {
  const filas = opciones.filas ?? [];
  const contarAportesPorCierre = vi.fn(async (f: FiltroAportesEnLote) => {
    const m = new Map<string, number>();
    for (const fila of filas) if (f.cierreIds.includes(fila.cierreId)) m.set(fila.cierreId, (m.get(fila.cierreId) ?? 0) + 1);
    return m;
  });
  const listarAportesDeCierres = vi.fn(async (f: FiltroAportesEnLote) => filas.filter((x) => f.cierreIds.includes(x.cierreId)));
  const cabecerasDeCierres = vi.fn(
    async (ids: readonly string[]) =>
      new Map<string, CabeceraDeCierre>(ids.map((id) => [id, { fecha: "2026-09-01T18:00:00.000Z", mensajeroNombre: "Mario Mensajero" }])),
  );
  const listarPorIdsDeTienda = vi.fn(async () => []);
  const listarPorIdsDeMensajero = vi.fn(async (ids: readonly string[]) =>
    (opciones.movimientos ?? []).filter((m) => ids.includes(m.id)),
  );
  const servicio = new DetalleEnLoteService(
    { contarAportesPorCierre, listarAportesDeCierres, cabecerasDeCierres },
    { listarPorIdsDeTienda },
    { listarPorIdsDeMensajero },
  );
  const llamadas = () =>
    contarAportesPorCierre.mock.calls.length +
    listarAportesDeCierres.mock.calls.length +
    cabecerasDeCierres.mock.calls.length +
    listarPorIdsDeTienda.mock.calls.length +
    listarPorIdsDeMensajero.mock.calls.length;
  return { servicio, contarAportesPorCierre, listarAportesDeCierres, cabecerasDeCierres, listarPorIdsDeMensajero, llamadas };
}

const MENSAJERO_OFICINA = { superficie: "mensajero_oficina" as const, mensajeroId: "m-1", movimientoIds: ["dev", "efe"] };

const TOPE_REAL = descargaConfig.MAX_FILAS;
afterEach(() => {
  descargaConfig.MAX_FILAS = TOPE_REAL;
});

describe("468 — R55: el detalle del mensajero exige acceso total, ANTES de la base", () => {
  it.each([MENSAJERO, ADMIN_TIENDA])("R55: «%o» recibe forbidden sin tocar ningun repositorio (detallar y contar)", async (actor) => {
    const m = montar({ movimientos: [movMensajero({ id: "dev" })] });
    expect(await m.servicio.detallar(MENSAJERO_OFICINA, actor)).toEqual({ status: "forbidden" });
    expect(await m.servicio.contar(MENSAJERO_OFICINA, actor)).toEqual({ status: "forbidden" });
    expect(m.llamadas()).toBe(0);
  });
});

describe("468 — R27/R31/R43: el lote del mensajero", () => {
  it("R27/R31/R43: el devengado se reparte por pago al mensajero (con tienda, sin mensajero); el efectivo no", async () => {
    const m = montar({
      filas: [orden("c-1", 1, "1000.00", "Tienda A"), orden("c-1", 2, "500.00", "Tienda B")],
      movimientos: [movMensajero({ id: "dev" }), movMensajero({ id: "efe", categoria: "pago_efectivo", monto: "900.00" })],
    });
    const r = await m.servicio.detallar(MENSAJERO_OFICINA, MAESTRO);
    if (r.status !== "ok") throw new Error(`se esperaba ok: ${r.status}`);
    // La re-lectura lleva el mensajero de la CUENTA (no una clave libre).
    expect(m.listarPorIdsDeMensajero).toHaveBeenCalledWith(["dev", "efe"], "m-1");
    expect(m.contarAportesPorCierre).toHaveBeenCalledWith(expect.objectContaining({ criterio: CRITERIO_PAGO_MENSAJERO, tiendaId: undefined }));
    const [dev, efe] = r.detalle;
    expect(dev.modo === "ordenes" && dev.ordenes.map((o) => [o.clave, o.tiendaNombre, o.aporte])).toEqual([
      ["o-1", "Tienda A", "1000.00"],
      ["o-2", "Tienda B", "500.00"],
    ]);
    expect(dev.modo === "ordenes" && { suma: dev.suma, cuadra: dev.cuadra, mensajero: dev.cierre.mensajeroNombre }).toEqual({
      suma: "1500.00",
      cuadra: true,
      mensajero: null, // R31: es su propia cuenta, la columna no existe
    });
    expect(efe).toEqual({ movimientoId: "efe", modo: "sin_reparto", motivo: "snapshot_del_cierre" }); // R43
  });

  it("un id que no es del libro de ESE mensajero no se inventa: falla ruidoso", async () => {
    const m = montar({ movimientos: [movMensajero({ id: "dev" })] });
    await expect(m.servicio.detallar(MENSAJERO_OFICINA, MAESTRO)).rejects.toThrow(/no pertenece al libro del mensajero/);
  });

  it("R56: por encima del tope, limite_excedido SIN leer ninguna orden (como la 464 en las demas superficies)", async () => {
    descargaConfig.MAX_FILAS = 1;
    const m = montar({
      filas: [orden("c-1", 1, "1000.00"), orden("c-1", 2, "500.00")],
      movimientos: [movMensajero({ id: "dev" }), movMensajero({ id: "efe", categoria: "pago_efectivo" })],
    });
    expect(await m.servicio.detallar(MENSAJERO_OFICINA, MAESTRO)).toEqual({ status: "limite_excedido", total: 2, limite: 1 });
    expect(m.listarAportesDeCierres).not.toHaveBeenCalled();
    expect(m.cabecerasDeCierres).not.toHaveBeenCalled();
  });
});

describe("468 — R18/R61: contar da los conteos y NUNCA lee una orden", () => {
  it("R61: contar devuelve cuantas ordenes por movimiento (null si no es repartible) sin listarAportesDeCierres", async () => {
    const m = montar({
      filas: [orden("c-1", 1, "1000.00"), orden("c-1", 2, "500.00"), orden("c-2", 3, "700.00")],
      movimientos: [
        movMensajero({ id: "dev" }),
        movMensajero({ id: "efe", categoria: "pago_efectivo" }),
        movMensajero({ id: "dev2", origenId: "c-2" }),
        movMensajero({ id: "liq", categoria: "liquidacion", origenTipo: "pago_mensajero", origenId: "p-1" }),
      ],
    });
    const r = await m.servicio.contar({ ...MENSAJERO_OFICINA, movimientoIds: ["dev", "efe", "dev2", "liq"] }, MAESTRO);
    expect(r).toEqual({ status: "ok", ordenes: [2, null, 1, null] });
    expect(m.listarAportesDeCierres).not.toHaveBeenCalled();
    expect(m.cabecerasDeCierres).not.toHaveBeenCalled();
  });

  it("R61: en la caja, un repartible sin ninguna orden cuenta 0 (no null), y contar no tiene tope", async () => {
    descargaConfig.MAX_FILAS = 0;
    const m = montar({ filas: [orden("c-1", 1, "1000.00")] });
    const r = await m.servicio.contar(
      {
        superficie: "caja",
        movimientos: [
          { id: "pago", categoria: "egreso_pago_mensajero", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c-1" },
          { id: "ind", categoria: "egreso_indemnizacion", monto: "50.00", origenTipo: "cierre_dia", origenId: "c-9" },
          { id: "g", categoria: "egreso_gasto", monto: "5.00", origenTipo: "gasto", origenId: null },
        ],
      },
      MAESTRO,
    );
    expect(r).toEqual({ status: "ok", ordenes: [1, 0, null] });
    expect(m.listarAportesDeCierres).not.toHaveBeenCalled();
  });
});
