import { describe, it, expect } from "vitest";

import {
  anularPagoPorCuentaTiendaSchema,
  registrarPagoPorCuentaTiendaSchema,
} from "@/lib/types/pago-por-cuenta-tienda";
import { anularAporteCapitalSchema, registrarAporteCapitalSchema } from "@/lib/types/aporte-capital";
import { fechaCalendarioCR, ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * FICHA 459 — el BORDE (zod `.strict()`) del pago por cuenta (R31–R37) y del saldo inicial o
 * aporte (R69). Cada rechazo se comprueba por el CAMPO que señala: el dialogo lo pinta ahi.
 */

const BASE = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: "7f1c2d3e-0000-4000-8000-00000000000a",
  beneficiario: "Facebook",
  monto: "10000.00",
  metodo: "SINPE",
  referencia: "123",
  motivo: "Publicidad",
};

function campos(r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return r.success ? [] : [...new Set(r.error!.issues.map((i) => String(i.path[0] ?? "")))].sort();
}

describe("459 — registrarPagoPorCuentaTiendaSchema", () => {
  it("control positivo: la entrada completa pasa", () => {
    expect(registrarPagoPorCuentaTiendaSchema.safeParse(BASE).success).toBe(true);
  });

  it("R31: beneficiario vacio tras recortar, o de mas de 120, -> beneficiario", () => {
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, beneficiario: "   " }))).toEqual(["beneficiario"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, beneficiario: "x".repeat(121) }))).toEqual(["beneficiario"]);
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, beneficiario: "x".repeat(120) }).success).toBe(true);
  });

  it.each(["0", "-5", "10.123", "abc", "", "10000000000.00"])("R32: monto %j -> monto", (monto) => {
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, monto }))).toEqual(["monto"]);
  });

  it("R32: el maximo de la columna (9 999 999 999,99) entra", () => {
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, monto: "9999999999.99" }).success).toBe(true);
  });

  it("R33: motivo vacio o de mas de 200 -> motivo", () => {
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, motivo: " " }))).toEqual(["motivo"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, motivo: "m".repeat(201) }))).toEqual(["motivo"]);
  });

  it("R34: SINPE o transferencia sin referencia, o referencia de mas de 60 -> referencia; efectivo sin ella entra", () => {
    const { referencia: _r, ...sinRef } = BASE;
    void _r;
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse(sinRef))).toEqual(["referencia"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...sinRef, metodo: "transferencia" }))).toEqual(["referencia"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, referencia: "r".repeat(61) }))).toEqual(["referencia"]);
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...sinRef, metodo: "efectivo" }).success).toBe(true);
  });

  it("R35: fecha inexistente, futura o fuera de la ventana -> fecha", () => {
    const hoy = fechaCalendarioCR(new Date());
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, fecha: "2026-02-31" }))).toEqual(["fecha"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, fecha: "2999-01-01" }))).toEqual(["fecha"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, fecha: "2020-01-01" }))).toEqual(["fecha"]);
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, fecha: hoy }).success).toBe(true);
    // El primer dia de la ventana todavia entra.
    const desde = ultimosNDiasCalendarioCR(31, new Date()).desde;
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, fecha: desde }).success).toBe(true);
  });

  it("R36 (forma): la tienda tiene que ser un uuid", () => {
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, tiendaId: "nuform" }))).toEqual(["tiendaId"]);
  });

  it("R37: una clave no prevista -> error de validacion", () => {
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, categoria: "ajuste_debito" }).success).toBe(false);
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, descripcion: "x" }).success).toBe(false);
  });

  it("R54: un comprobante de tipo no admitido o de mas de 4 MB -> comprobante", () => {
    const archivo = (type: string, size: number) => ({ type, size, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, comprobante: archivo("image/gif", 10) }))).toEqual(["comprobante"]);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, comprobante: archivo("application/pdf", 4 * 1024 * 1024 + 1) }))).toEqual(["comprobante"]);
    expect(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, comprobante: archivo("application/pdf", 1000) }).success).toBe(true);
    expect(campos(registrarPagoPorCuentaTiendaSchema.safeParse({ ...BASE, comprobante: "no-es-archivo" }))).toEqual(["comprobante"]);
  });
});

describe("459 — anularPagoPorCuentaTiendaSchema", () => {
  const OK = { pagoId: "7f1c2d3e-0000-4000-8000-00000000000c", motivo: "Error" };
  it("R49: motivo vacio -> rechazado", () => {
    expect(anularPagoPorCuentaTiendaSchema.safeParse({ ...OK, motivo: "  " }).success).toBe(false);
    expect(anularPagoPorCuentaTiendaSchema.safeParse(OK).success).toBe(true);
  });
  it("R37: un monto en la anulacion -> rechazado", () => {
    expect(anularPagoPorCuentaTiendaSchema.safeParse({ ...OK, monto: "1.00" }).success).toBe(false);
  });
});

describe("459 — registrarAporteCapitalSchema (R69)", () => {
  const OK = {
    claveIdempotencia: "22222222-2222-4222-8222-222222222222",
    clase: "saldo_inicial",
    monto: "1000000.00",
    fecha: "2025-01-01",
    motivo: "Saldo del banco al empezar",
  };
  it("control positivo, y SIN ventana hacia atras (P7)", () => {
    expect(registrarAporteCapitalSchema.safeParse(OK).success).toBe(true);
  });
  it("sin clase, o con una clase ajena -> clase", () => {
    const { clase: _c, ...sinClase } = OK;
    void _c;
    expect(campos(registrarAporteCapitalSchema.safeParse(sinClase))).toEqual(["clase"]);
    expect(campos(registrarAporteCapitalSchema.safeParse({ ...OK, clase: "ganancia" }))).toEqual(["clase"]);
  });
  it("monto, motivo y fecha invalidos, cada uno en su campo; clave no prevista -> rechazo", () => {
    expect(campos(registrarAporteCapitalSchema.safeParse({ ...OK, monto: "0" }))).toEqual(["monto"]);
    expect(campos(registrarAporteCapitalSchema.safeParse({ ...OK, motivo: "" }))).toEqual(["motivo"]);
    expect(campos(registrarAporteCapitalSchema.safeParse({ ...OK, fecha: "2999-01-01" }))).toEqual(["fecha"]);
    expect(campos(registrarAporteCapitalSchema.safeParse({ ...OK, fecha: "2026-02-30" }))).toEqual(["fecha"]);
    expect(registrarAporteCapitalSchema.safeParse({ ...OK, sugerido: "1.00" }).success).toBe(false);
  });
  it("R74: la anulacion no admite monto", () => {
    const a = { aporteId: "7f1c2d3e-0000-4000-8000-00000000000d", motivo: "x" };
    expect(anularAporteCapitalSchema.safeParse(a).success).toBe(true);
    expect(anularAporteCapitalSchema.safeParse({ ...a, monto: "1" }).success).toBe(false);
  });
});
