import { describe, it, expect, vi } from "vitest";

import {
  verEstadoCuentaCompletoConDetalleAction,
  verMiEstadoCuentaCompletoConDetalleAction,
} from "@/lib/actions/estado-cuenta";
import { listarMovimientosCompletoConDetalleAction } from "@/lib/actions/wallet";
import { CajaConDetalleService, EstadoCuentaConDetalleService } from "@/lib/services/LibroConDetalleService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IDetalleEnLoteService } from "@/lib/interfaces/services/IDetalleEnLoteService";
import type { ICajaConDetalleService } from "@/lib/interfaces/services/ICajaConDetalleService";
import type { IEstadoCuentaConDetalleService } from "@/lib/interfaces/services/IEstadoCuentaConDetalleService";
import type { DetalleDeMovimientoLoteDTO, DetalleEnLoteServiceResult } from "@/lib/types/detalle-en-lote";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { ORIGENES_FALSOS, ORIGEN_FALSO } from "@/tests/fixtures/origenes-falsos";

// FICHA 464 / T6 — la ORQUESTACION (dos hojas de una sola lectura) y los TRES BORDES nuevos, con
// dobles. Cubre R14, R35, R36, R38, R39 en su parte de borde/servicio; el diferencial contra Postgres
// (R21/R22/R34) vive en `tests/integration/db/detalle-en-lote-464.test.ts`.

const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000aa", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-0000000000bb", rol: "adminTienda" };
const CUENTA_TIENDA = { tipo: "tienda", id: "00000000-0000-4000-8000-0000000000cc" } as const;

function movimiento(id: string, over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id,
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-09-01T18:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

function filaDeCuenta(movimientoId: string): FilaEstadoCuentaDTO {
  return {
    ref: { libro: "tienda", movimientoId },
    consolidacionId: null,
    fecha: "2026-09-01",
    categoria: "flete",
    origenTipo: "cierre_dia",
    origen: null,
    pago: null,
    descripcion: null,
    registro: { nombre: null, automatico: null },
    cargo: "1000.00",
    abono: null,
    saldoCorrido: "-1000.00",
    chip: "cierres",
    anulacion: null,
    esContraAsiento: false,
    tieneComprobante: false,
    anulable: false,
    naceDeUnCierre: true,
  } as FilaEstadoCuentaDTO;
}

function estado(ids: string[]): EstadoCuentaDTO {
  return {
    cuenta: { tipo: "tienda", id: CUENTA_TIENDA.id, nombre: "Tienda" },
    saldoActual: "0.00",
    signo: "cero",
    sentido: "en_cero",
    saldoInicial: "0.00",
    abonos: "0.00",
    cargos: "0.00",
    saldoFinal: "0.00",
    resumen: null,
    filas: ids.map(filaDeCuenta),
    total: ids.length,
    page: 1,
    pageSize: ids.length,
  };
}

const DETALLE: DetalleDeMovimientoLoteDTO[] = [
  { movimientoId: "m2", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
];

function detalleEspia(r: DetalleEnLoteServiceResult = { status: "ok", detalle: DETALLE }) {
  const detallar = vi.fn<IDetalleEnLoteService["detallar"]>(async () => r);
  const servicio: IDetalleEnLoteService = { detallar };
  return { servicio, detallar };
}

describe("464 / T6 — CajaConDetalleService: dos hojas de UNA lectura", () => {
  it("R14/R36: la hoja de movimientos es la del completo de siempre, y el detalle es de ESOS movimientos", async () => {
    const items = [movimiento("m2"), movimiento("m1", { categoria: "egreso_gasto", origenTipo: "gasto", origenId: "g" })];
    const listarMovimientosCompleto = vi.fn(async () => ({ status: "ok" as const, items, total: 2 }));
    const d = detalleEspia();
    const s = new CajaConDetalleService({ listarMovimientosCompleto }, d.servicio);
    const entrada = { q: "flete", sortBy: "fecha" as const, sortDir: "asc" as const, tipo: "ingreso" as const };

    const r = await s.cajaConDetalle(entrada, MAESTRO);

    expect(listarMovimientosCompleto).toHaveBeenCalledWith(entrada, MAESTRO);
    expect(r).toEqual({ status: "ok", items, total: 2, detalle: DETALLE });
    expect(d.detallar).toHaveBeenCalledTimes(1);
    expect(d.detallar.mock.calls[0][0]).toEqual({
      superficie: "caja",
      movimientos: [
        { id: "m2", categoria: "ingreso_flete", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c-1" },
        { id: "m1", categoria: "egreso_gasto", monto: "1000.00", origenTipo: "gasto", origenId: "g" },
      ],
    });
    expect(d.detallar.mock.calls[0][1]).toBe(MAESTRO);
  });

  it("R38: el tope de la hoja de movimientos pasa tal cual (hoja «movimientos») y NO se pide el detalle", async () => {
    const d = detalleEspia();
    const s = new CajaConDetalleService(
      { listarMovimientosCompleto: vi.fn(async () => ({ status: "limite_excedido" as const, total: 5001, limite: 5000 })) },
      d.servicio,
    );
    expect(await s.cajaConDetalle({}, MAESTRO)).toEqual({
      status: "limite_excedido",
      hoja: "movimientos",
      total: 5001,
      limite: 5000,
    });
    expect(d.detallar).not.toHaveBeenCalled();
  });

  it("R39: el tope del detalle sale con hoja «detalle» y sin filas", async () => {
    const d = detalleEspia({ status: "limite_excedido", total: 9000, limite: 5000 });
    const s = new CajaConDetalleService(
      { listarMovimientosCompleto: vi.fn(async () => ({ status: "ok" as const, items: [movimiento("m1")], total: 1 })) },
      d.servicio,
    );
    expect(await s.cajaConDetalle({}, MAESTRO)).toEqual({
      status: "limite_excedido",
      hoja: "detalle",
      total: 9000,
      limite: 5000,
    });
  });

  it("forbidden del libro o del detalle pasa tal cual, sin filas", async () => {
    const d = detalleEspia();
    const s = new CajaConDetalleService(
      { listarMovimientosCompleto: vi.fn(async () => ({ status: "forbidden" as const })) },
      d.servicio,
    );
    expect(await s.cajaConDetalle({}, MAESTRO)).toEqual({ status: "forbidden" });
    expect(d.detallar).not.toHaveBeenCalled();
    const s2 = new CajaConDetalleService(
      { listarMovimientosCompleto: vi.fn(async () => ({ status: "ok" as const, items: [], total: 0 })) },
      detalleEspia({ status: "forbidden" }).servicio,
    );
    expect(await s2.cajaConDetalle({}, MAESTRO)).toEqual({ status: "forbidden" });
  });
});

describe("464 / T6 — EstadoCuentaConDetalleService", () => {
  function estadoEspia(ids: string[]) {
    return {
      leerCompleto: vi.fn(async () => ({ status: "ok" as const, estado: estado(ids) })),
      leerMiTiendaCompleto: vi.fn(async () => ({ status: "ok" as const, estado: estado(ids) })),
    };
  }

  it("oficina: el detalle se pide para los ids de la hoja, en su orden, con la tienda de la cuenta leida", async () => {
    const e = estadoEspia(["m3", "m1", "m2"]);
    const d = detalleEspia();
    const s = new EstadoCuentaConDetalleService(e, d.servicio);
    const entrada = { cuenta: CUENTA_TIENDA, sortBy: "fecha" as const, sortDir: "desc" as const };
    const r = await s.tiendaConDetalle(entrada, MAESTRO);
    expect(e.leerCompleto).toHaveBeenCalledWith(entrada, MAESTRO);
    expect(d.detallar.mock.calls[0][0]).toEqual({
      superficie: "tienda_oficina",
      tiendaId: CUENTA_TIENDA.id,
      movimientoIds: ["m3", "m1", "m2"],
    });
    expect(r).toEqual({ status: "ok", estado: estado(["m3", "m1", "m2"]), detalle: DETALLE });
  });

  it("R7: una cuenta que no es tienda -> validation_error sin leer nada", async () => {
    const e = estadoEspia([]);
    const d = detalleEspia();
    const s = new EstadoCuentaConDetalleService(e, d.servicio);
    const r = await s.tiendaConDetalle(
      { cuenta: { tipo: "mensajero", id: CUENTA_TIENDA.id }, sortBy: "fecha", sortDir: "desc" },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    expect(e.leerCompleto).not.toHaveBeenCalled();
    expect(d.detallar).not.toHaveBeenCalled();
  });

  it("/mi-wallet: superficie mi_wallet, sin tiendaId en la entrada del detalle (sale del actor)", async () => {
    const e = estadoEspia(["m1"]);
    const d = detalleEspia();
    const s = new EstadoCuentaConDetalleService(e, d.servicio);
    await s.miTiendaConDetalle({ sortBy: "fecha", sortDir: "desc" }, TIENDA);
    expect(e.leerMiTiendaCompleto).toHaveBeenCalledTimes(1);
    expect(d.detallar.mock.calls[0][0]).toEqual({ superficie: "mi_wallet", movimientoIds: ["m1"] });
    expect(d.detallar.mock.calls[0][1]).toBe(TIENDA);
  });

  it("R38: el tope del estado de cuenta pasa con hoja «movimientos»; no_encontrado/forbidden tal cual", async () => {
    const d = detalleEspia();
    const s = new EstadoCuentaConDetalleService(
      {
        leerCompleto: vi.fn(async () => ({ status: "limite_excedido" as const, total: 6, limite: 5 })),
        leerMiTiendaCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
      },
      d.servicio,
    );
    expect(await s.tiendaConDetalle({ cuenta: CUENTA_TIENDA, sortBy: "fecha", sortDir: "desc" }, MAESTRO)).toEqual({
      status: "limite_excedido",
      hoja: "movimientos",
      total: 6,
      limite: 5,
    });
    expect(await s.miTiendaConDetalle({ sortBy: "fecha", sortDir: "desc" }, MAESTRO)).toEqual({ status: "forbidden" });
    expect(d.detallar).not.toHaveBeenCalled();
  });

  it("R39: el tope del detalle en /mi-wallet sale con hoja «detalle»", async () => {
    const s = new EstadoCuentaConDetalleService(estadoEspia(["m1"]), detalleEspia({ status: "limite_excedido", total: 7, limite: 5 }).servicio);
    expect(await s.miTiendaConDetalle({ sortBy: "fecha", sortDir: "desc" }, TIENDA)).toEqual({
      status: "limite_excedido",
      hoja: "detalle",
      total: 7,
      limite: 5,
    });
  });
});

describe("464 / T6 — los bordes", () => {
  function cajaEspia(): ICajaConDetalleService & { cajaConDetalle: ReturnType<typeof vi.fn> } {
    return {
      cajaConDetalle: vi.fn(async () => ({ status: "ok" as const, items: [movimiento("m1")], total: 1, detalle: DETALLE })),
    };
  }
  function cuentaEspia(): IEstadoCuentaConDetalleService & {
    tiendaConDetalle: ReturnType<typeof vi.fn>;
    miTiendaConDetalle: ReturnType<typeof vi.fn>;
  } {
    return {
      tiendaConDetalle: vi.fn(async () => ({ status: "no_encontrado" as const })),
      miTiendaConDetalle: vi.fn(async () => ({ status: "no_encontrado" as const })),
    };
  }

  it("caja: filtros, termino y orden de la 463 llegan al servicio; el ok lleva origen en cada fila y el detalle", async () => {
    const service = cajaEspia();
    const r = await listarMovimientosCompletoConDetalleAction(
      { q: "  flete  ", sortDir: "asc", tipo: "ingreso", desde: "2026-09-01" },
      { service, getActor: async () => MAESTRO, origenes: ORIGENES_FALSOS },
    );
    expect(service.cajaConDetalle).toHaveBeenCalledTimes(1);
    expect(service.cajaConDetalle.mock.calls[0][0]).toMatchObject({
      q: "flete",
      sortBy: "fecha",
      sortDir: "asc",
      tipo: "ingreso",
      desde: new Date("2026-09-01T06:00:00.000Z"), // el esquema de la caja lo convierte al inicio del dia CR
    });
    expect(r).toEqual({
      status: "ok",
      items: [{ ...movimiento("m1"), origen: ORIGEN_FALSO }],
      total: 1,
      detalle: DETALLE,
    });
  });

  it("caja: `.strict()` — una clave colada (page, tiendaId) es validation_error sin llamar al servicio", async () => {
    for (const colada of [{ page: 1 }, { tiendaId: CUENTA_TIENDA.id }, { conDetalle: true }]) {
      const service = cajaEspia();
      const r = await listarMovimientosCompletoConDetalleAction(colada, {
        service,
        getActor: async () => MAESTRO,
        origenes: ORIGENES_FALSOS,
      });
      expect(r.status).toBe("validation_error");
      expect(service.cajaConDetalle).not.toHaveBeenCalled();
    }
  });

  it("sin sesion: unauthenticated en las tres, sin tocar el servicio", async () => {
    const caja = cajaEspia();
    const cuenta = cuentaEspia();
    const sinActor = async () => null;
    expect(await listarMovimientosCompletoConDetalleAction({}, { service: caja, getActor: sinActor })).toEqual({
      status: "unauthenticated",
    });
    expect(
      await verEstadoCuentaCompletoConDetalleAction({ cuenta: CUENTA_TIENDA }, { service: cuenta, getActor: sinActor }),
    ).toEqual({ status: "unauthenticated" });
    expect(await verMiEstadoCuentaCompletoConDetalleAction({}, { service: cuenta, getActor: sinActor })).toEqual({
      status: "unauthenticated",
    });
    expect(caja.cajaConDetalle).not.toHaveBeenCalled();
    expect(cuenta.tiendaConDetalle).not.toHaveBeenCalled();
    expect(cuenta.miTiendaConDetalle).not.toHaveBeenCalled();
  });

  it("R35: /mi-wallet con un identificador de tienda o de cuenta -> validation_error sin leer nada", async () => {
    for (const colada of [{ tiendaId: CUENTA_TIENDA.id }, { cuenta: CUENTA_TIENDA }, { cuentaId: CUENTA_TIENDA.id }]) {
      const service = cuentaEspia();
      const r = await verMiEstadoCuentaCompletoConDetalleAction(colada, { service, getActor: async () => TIENDA });
      expect(r.status).toBe("validation_error");
      expect(service.miTiendaConDetalle).not.toHaveBeenCalled();
    }
  });

  it("R7: la oficina con una cuenta que no es tienda -> validation_error en el borde, sin servicio", async () => {
    for (const tipo of ["mensajero", "bodega"] as const) {
      const service = cuentaEspia();
      const r = await verEstadoCuentaCompletoConDetalleAction(
        { cuenta: { tipo, id: CUENTA_TIENDA.id } },
        { service, getActor: async () => MAESTRO },
      );
      expect(r).toMatchObject({ status: "validation_error", fieldErrors: { cuenta: [expect.stringMatching(/tienda/)] } });
      expect(service.tiendaConDetalle).not.toHaveBeenCalled();
    }
  });

  it("oficina y /mi-wallet: termino y orden por defecto llegan al servicio (desc por defecto, 463)", async () => {
    const service = cuentaEspia();
    await verEstadoCuentaCompletoConDetalleAction(
      { cuenta: CUENTA_TIENDA, q: "pago" },
      { service, getActor: async () => MAESTRO },
    );
    expect(service.tiendaConDetalle.mock.calls[0][0]).toEqual({
      cuenta: CUENTA_TIENDA,
      q: "pago",
      sortBy: "fecha",
      sortDir: "desc",
    });
    await verMiEstadoCuentaCompletoConDetalleAction({ sortDir: "asc" }, { service, getActor: async () => TIENDA });
    expect(service.miTiendaConDetalle.mock.calls[0][0]).toEqual({ sortBy: "fecha", sortDir: "asc" });
    expect(service.miTiendaConDetalle.mock.calls[0][1]).toBe(TIENDA);
  });
});
