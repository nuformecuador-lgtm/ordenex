import { describe, it, expect, vi, beforeEach } from "vitest";

// Ningun camino de este archivo debe construir el Storage real (el `.env` local apunta a PRODUCCION).
const almacenCtor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/SupabaseAlmacenDescargas", () => ({
  SupabaseAlmacenDescargas: class {
    constructor(...args: unknown[]) {
      almacenCtor(...args);
    }
  },
}));

import { prepararDescargaAction } from "@/lib/actions/descargas";
import { NOMBRES_DESCARGA, REGISTRO_DESCARGAS } from "@/lib/actions/_shared/registro-descargas";
import type { IEntregaDescargaService } from "@/lib/interfaces/services/IEntregaDescargaService";

// Ficha 470 (T3.3, R5/R6/R11/R12/R13/R15) — la preparacion de una descarga, con registro y entrega
// inyectados.

function montar(resultadoAccion: unknown = { status: "ok", items: [{ id: "o-1" }], total: 1 }) {
  const accion = vi.fn(async (..._args: unknown[]) => resultadoAccion);
  const otra = vi.fn(async (..._args: unknown[]) => ({ status: "ok", items: [], total: 0 }));
  const registro = { listarOrdenesCompleto: accion, libroCajaKardexConDetalle: otra };
  const entregar = vi.fn(async (r: unknown) => ({ modo: "directo" as const, resultado: r }));
  const entrega = { entregar } as unknown as IEntregaDescargaService;
  return { accion, otra, registro, entregar, entrega };
}

beforeEach(() => almacenCtor.mockClear());

describe("R12 — un nombre fuera del registro se rechaza sin ejecutar nada", () => {
  it.each(["borrarTodo", "", 123, null, undefined, { nombre: "listarOrdenesCompleto" }, "__proto__", "constructor", "toString"])(
    "%o ⇒ validation_error; ninguna accion ni entrega llamadas",
    async (nombre) => {
      const m = montar();
      const r = await prepararDescargaAction(nombre, {}, { registro: m.registro, entrega: m.entrega });
      expect(r).toEqual({ status: "validation_error", fieldErrors: { nombre: ["Descarga desconocida"] } });
      expect(m.accion).not.toHaveBeenCalled();
      expect(m.otra).not.toHaveBeenCalled();
      expect(m.entregar).not.toHaveBeenCalled();
      expect(almacenCtor).not.toHaveBeenCalled();
    },
  );

  it("un nombre valido del registro REAL que el registro inyectado no tiene ⇒ rechazo, sin ejecutar", async () => {
    const m = montar();
    const r = await prepararDescargaAction("listarUsuariosCompleto", {}, { registro: m.registro, entrega: m.entrega });
    expect(r).toMatchObject({ status: "validation_error" });
    expect(m.entregar).not.toHaveBeenCalled();
  });
});

describe("R13 — la accion registrada recibe EXACTAMENTE la entrada, y un solo argumento", () => {
  it("mismo objeto de entrada, un argumento, ninguna otra accion", async () => {
    const m = montar();
    const input = { desde: "2026-09-01", estatus: ["entregado"] };
    await prepararDescargaAction("listarOrdenesCompleto", input, { registro: m.registro, entrega: m.entrega });
    expect(m.accion).toHaveBeenCalledTimes(1);
    expect(m.accion.mock.calls[0].length).toBe(1);
    expect(m.accion.mock.calls[0][0]).toBe(input);
    expect(m.otra).not.toHaveBeenCalled();
  });
});

describe("R5/R6 — lo que devuelve la accion va a `entregar` tal cual y su salida es la respuesta", () => {
  it("directo", async () => {
    const resultado = { status: "ok", items: [{ id: "o-9" }], total: 1 };
    const m = montar(resultado);
    const r = await prepararDescargaAction("listarOrdenesCompleto", {}, { registro: m.registro, entrega: m.entrega });
    expect(m.entregar).toHaveBeenCalledWith(resultado);
    expect(m.entregar.mock.calls[0][0]).toBe(resultado);
    expect(r).toEqual({ modo: "directo", resultado });
  });

  it("almacen", async () => {
    const m = montar();
    m.entregar.mockResolvedValueOnce({ modo: "almacen", url: "https://firmada" } as never);
    expect(await prepararDescargaAction("listarOrdenesCompleto", {}, { registro: m.registro, entrega: m.entrega })).toEqual({
      modo: "almacen",
      url: "https://firmada",
    });
  });

  it("R11: un resultado de error de la accion pasa por `entregar` (que lo devuelve directo) sin cambiar", async () => {
    const m = montar({ status: "forbidden" });
    expect(await prepararDescargaAction("listarOrdenesCompleto", {}, { registro: m.registro, entrega: m.entrega })).toEqual({
      modo: "directo",
      resultado: { status: "forbidden" },
    });
  });
});

describe("R15 — `entregar` lanza ⇒ error devuelto, NO excepcion", () => {
  it("fallo del almacen ⇒ AppErrorShape INTERNAL con mensaje generico (sin detalles internos)", async () => {
    const m = montar();
    m.entregar.mockRejectedValueOnce(new Error("fallo al subir la descarga temporal: Bucket secreto"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await prepararDescargaAction("listarOrdenesCompleto", {}, { registro: m.registro, entrega: m.entrega });
      expect(r).toMatchObject({ status: "error", code: "INTERNAL" });
      expect(JSON.stringify(r)).not.toMatch(/Bucket secreto|fallo al subir/);
    } finally {
      logger.mockRestore();
    }
  });

  it("la accion registrada lanza ⇒ tambien error devuelto, y `entregar` no se llama", async () => {
    const m = montar();
    m.accion.mockRejectedValueOnce(new Error("boom"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await prepararDescargaAction("listarOrdenesCompleto", {}, { registro: m.registro, entrega: m.entrega });
      expect(r).toMatchObject({ status: "error", code: "INTERNAL" });
      expect(m.entregar).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
});

describe("el registro real (design §2.1)", () => {
  it("contiene exactamente las 33 descargas del inventario", () => {
    expect([...NOMBRES_DESCARGA].sort()).toEqual(
      [
        "listarOrdenesCompleto",
        "listarUsuariosCompleto",
        "listarApiKeysCompleto",
        "listarPlantillasCompleto",
        "listarCoberturaDistritos",
        "listarPlantillasGastoFijoCompleto",
        "listarCierresPasadosCompleto",
        "listarPendientesCierresAdminCompleto",
        "listarHistoricoCierresAdminCompleto",
        "listarGestionesCierresAdminCompleto",
        "listarCierresBodegaSolicitadosCompleto",
        "listarConsolidablesCompleto",
        "listarPendientesCierresBodegaCompleto",
        "listarHistoricoCierresBodegaCompleto",
        "listarGestionesCierresBodegaCompleto",
        "listarSaldosSatelitesCompleto",
        "listarConsolidacionesSateliteCompleto",
        "listarHistorialAccionesCompleto",
        "listarHistoricoIncidentesCompleto",
        "listarPendientesIncidentesCompleto",
        "listarNovedadesCompleto",
        "listarAyudaTiendaCompleto",
        "listarOrdenesBodegaCompleto",
        "listarCuentasPorPagarCompleto",
        "libroCajaKardex",
        "libroCajaKardexConDetalle",
        "verDetalleDeMovimientoCompleto",
        "listarSaldosTiendasCompleto",
        "verDetalleDeMiMovimientoCompleto",
        "estadoCuentaKardex",
        "estadoCuentaKardexConDetalle",
        "miEstadoCuentaKardex",
        "miEstadoCuentaKardexConDetalle",
      ].sort(),
    );
  });

  it("cada entrada es un envoltorio de a lo sumo UN argumento (nunca reenvia `deps`)", () => {
    for (const [nombre, fn] of Object.entries(REGISTRO_DESCARGAS)) {
      expect(fn.length, nombre).toBeLessThanOrEqual(1);
    }
  });
});
