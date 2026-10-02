import { describe, it, expect } from "vitest";

import {
  CRITERIO_COD_RECAUDADO,
  CRITERIO_DE_APORTE,
  FUENTE_CAJA,
  FUENTE_TIENDA,
  fuenteDeMovimiento,
} from "@/lib/utils/aporte-por-orden";
import { loadDetalleMovimientoConfig } from "@/lib/config/detalle-movimiento";

/**
 * Ficha 464 (T3) — `fuenteDeMovimiento`: la decision «se reparte por orden, y de que cierre», UNA vez
 * para el detalle de una fila (344/458-D) y para el lote de la descarga (R21). Cada rama.
 */

const DE_CIERRE = { origenTipo: "cierre_dia", origenId: "c-1" };

describe("464 / T3 — fuenteDeMovimiento", () => {
  it("concepto con reparto que nace de un cierre -> el criterio del concepto y su cierre", () => {
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_CAJA.ingreso_flete)).toEqual({
      tipo: "reparto",
      criterio: CRITERIO_DE_APORTE.ingreso_flete,
      cierreId: "c-1",
    });
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_TIENDA.cod_recaudado)).toEqual({
      tipo: "reparto",
      criterio: CRITERIO_COD_RECAUDADO,
      cierreId: "c-1",
    });
    // el MISMO objeto de criterio (identidad): nada se copia ni se reescribe
    const d = fuenteDeMovimiento(DE_CIERRE, FUENTE_TIENDA.comision_cod);
    expect(d.tipo === "reparto" && d.criterio).toBe(CRITERIO_DE_APORTE.ingreso_comision_cod);
  });

  it("concepto con reparto que NO nace de un cierre -> sin_reparto «no_nace_de_un_cierre»", () => {
    expect(fuenteDeMovimiento({ origenTipo: "manual", origenId: "x" }, FUENTE_CAJA.ingreso_flete)).toEqual({
      tipo: "sin_reparto",
      motivo: "no_nace_de_un_cierre",
    });
    expect(fuenteDeMovimiento({ origenTipo: "cierre_dia", origenId: null }, FUENTE_TIENDA.flete)).toEqual({
      tipo: "sin_reparto",
      motivo: "no_nace_de_un_cierre",
    });
  });

  it("concepto sin reparto -> su motivo del catalogo, aunque nazca de un cierre", () => {
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_CAJA.egreso_pago_mensajero)).toEqual({
      tipo: "sin_reparto",
      motivo: "snapshot_del_cierre",
    });
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_CAJA.ingreso_cod_recaudado)).toEqual({
      tipo: "sin_reparto",
      motivo: "suma_del_libro_por_tienda",
    });
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_CAJA.egreso_indemnizacion)).toEqual({
      tipo: "sin_reparto",
      motivo: "otro_productor",
    });
    expect(fuenteDeMovimiento(DE_CIERRE, FUENTE_TIENDA.pago_tienda)).toEqual({
      tipo: "sin_reparto",
      motivo: "no_nace_de_un_cierre",
    });
  });
});

describe("464 — TRAMO_CIERRES_LOTE sale de la configuracion (R37)", () => {
  it("100 por defecto y movible por entorno", () => {
    const previo = process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE;
    try {
      delete process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE;
      expect(loadDetalleMovimientoConfig().TRAMO_CIERRES_LOTE).toBe(100);
      process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE = "7";
      expect(loadDetalleMovimientoConfig().TRAMO_CIERRES_LOTE).toBe(7);
      process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE = "0";
      expect(loadDetalleMovimientoConfig().TRAMO_CIERRES_LOTE).toBe(100);
    } finally {
      if (previo === undefined) delete process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE;
      else process.env.DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE = previo;
    }
  });
});
