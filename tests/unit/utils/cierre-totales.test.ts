import { describe, it, expect } from "vitest";
import {
  computeTotales,
  derivarPagos,
  derivarIngresoBodega,
} from "@/lib/utils/cierre-totales";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Feature 41/B2 (R4/R8) — helpers de snapshot money-safe reutilizados por
// solicitarCierre (37/39/56) y el corte diario (41). La aritmetica Prisma.Decimal NO
// cambia: los totales se congelan como STRING escala 2 al crearse (money-critical).

const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };

function g(overrides: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1,
    numRemision: "R1",
    destinatario: "Ana",
    direccion: null,
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: null,
    producto: "X",
    tiendaNombre: "T",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false, // feature 102
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...overrides,
  };
}

describe("computeTotales (R8) — money-safe por metodo de pago", () => {
  it("suma solo entregadas con monto, por metodo; STRING escala 2", () => {
    const totales = computeTotales([
      g({ gestionId: "a", montoRecibido: "10.50", metodoPago: "efectivo" }),
      g({ gestionId: "b", montoRecibido: "4.50", metodoPago: "SINPE" }),
      g({ gestionId: "c", montoRecibido: "2.00", metodoPago: "transferencia" }),
      g({ gestionId: "d", resultado: "rechazada", montoRecibido: "99.00", metodoPago: "efectivo" }),
    ]);
    expect(totales).toEqual({
      efectivo: "10.50", // la rechazada NO suma (R8)
      simpe: "4.50",
      transferencia: "2.00",
      general: "17.00",
    });
    expect(typeof totales.general).toBe("string");
  });
});

describe("derivarPagos (R8) — pago al mensajero snapshot", () => {
  it("solo entregada paga cobroEntregado; resto 0.00; total STRING", () => {
    const { pagoByGestionId, total } = derivarPagos(
      [
        g({ gestionId: "a", resultado: "entregada" }),
        g({ gestionId: "b", resultado: "rechazada" }),
      ],
      TARIFA,
    );
    expect(pagoByGestionId).toEqual({ a: "5.00", b: "0.00" });
    expect(total).toBe("5.00");
  });

  it("tarifa null -> pago 0.00 no bloqueante", () => {
    const { total } = derivarPagos([g({ resultado: "entregada" })], null);
    expect(total).toBe("0.00");
  });
});

describe("derivarIngresoBodega (R8) — ingreso de bodega por rechazo snapshot", () => {
  it("solo rechazada con tarifa genera cobroRechazado; resto 0.00", () => {
    const { ingresoByGestionId, total } = derivarIngresoBodega(
      [
        g({ gestionId: "a", resultado: "rechazada" }),
        g({ gestionId: "b", resultado: "entregada" }),
      ],
      TARIFA,
    );
    expect(ingresoByGestionId).toEqual({ a: "3.00", b: "0.00" });
    expect(total).toBe("3.00");
  });
});
