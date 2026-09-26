import { describe, it, expect } from "vitest";

import {
  ABONO_TIENDA_MOTIVO_MAX,
  anularAbonoTiendaSchema,
  obtenerComprobanteAbonoSchema,
  registrarAbonoTiendaSchema,
} from "@/lib/types/abono-tienda";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * FICHA 457 / T2.5 — el BORDE (zod `.strict()`) del pago de una tienda a Ordenex (R4–R9, R12, R13)
 * y de su anulacion (R34, R35). Cada rechazo se comprueba por el CAMPO que señala: el dialogo lo
 * pinta ahi (R58).
 */

const HOY = fechaCalendarioCR(new Date());

const BASE = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: "7f1c2d3e-0000-4000-8000-00000000000a",
  monto: "10000.00",
  metodo: "SINPE",
  referencia: "123456",
  motivo: "Pago de lo que debía por los fletes de septiembre",
  fechaPago: "2026-09-20",
};

function campos(r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return r.success ? [] : [...new Set(r.error!.issues.map((i) => String(i.path[0] ?? "")))].sort();
}

describe("457 — registrarAbonoTiendaSchema", () => {
  it("control positivo: la entrada completa pasa, y recorta el motivo y la referencia", () => {
    const r = registrarAbonoTiendaSchema.safeParse({ ...BASE, motivo: "  Pago  ", referencia: " 77 " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.motivo).toBe("Pago");
    expect(r.data.referencia).toBe("77");
    expect(r.data.fechaPago).toBe("2026-09-20");
  });

  it.each(["0", "-5", "10.123", "abc", "", "10000000000.00"])("R4: monto %j -> monto", (monto) => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, monto }))).toEqual(["monto"]);
  });

  it("R4/R5: el monto viaja como STRING; el maximo de la columna (9 999 999 999,99) entra y un number no", () => {
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, monto: "9999999999.99" }).success).toBe(true);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, monto: "6170666.55" }).success).toBe(true);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, monto: 10000 }))).toEqual(["monto"]);
  });

  it("R6: motivo vacio tras recortar, o de mas de 200 -> motivo; 200 exactos entran", () => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, motivo: "   " }))).toEqual(["motivo"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, motivo: "m".repeat(ABONO_TIENDA_MOTIVO_MAX + 1) }))).toEqual(["motivo"]);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, motivo: "m".repeat(ABONO_TIENDA_MOTIVO_MAX) }).success).toBe(true);
    expect(ABONO_TIENDA_MOTIVO_MAX).toBe(200);
    const { motivo: _m, ...sinMotivo } = BASE;
    void _m;
    expect(campos(registrarAbonoTiendaSchema.safeParse(sinMotivo))).toEqual(["motivo"]);
  });

  it("R7: SINPE o transferencia sin referencia -> referencia; efectivo sin ella entra", () => {
    const { referencia: _r, ...sinRef } = BASE;
    void _r;
    expect(campos(registrarAbonoTiendaSchema.safeParse(sinRef))).toEqual(["referencia"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...sinRef, metodo: "transferencia" }))).toEqual(["referencia"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, referencia: "   " }))).toEqual(["referencia"]);
    expect(registrarAbonoTiendaSchema.safeParse({ ...sinRef, metodo: "efectivo" }).success).toBe(true);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, metodo: "efectivo", referencia: "opcional" }).success).toBe(true);
  });

  it("R8: referencia de mas de 60 tras recortar -> referencia; 60 exactos entran", () => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, referencia: "r".repeat(61) }))).toEqual(["referencia"]);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, referencia: "r".repeat(60) }).success).toBe(true);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, referencia: ` ${"r".repeat(60)} ` }).success).toBe(true);
  });

  it("R9 (D3): fecha inexistente o posterior a hoy en CR -> fechaPago; hoy y un dia de hace meses entran", () => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, fechaPago: "2026-02-31" }))).toEqual(["fechaPago"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, fechaPago: "2999-01-01" }))).toEqual(["fechaPago"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, fechaPago: "20-09-2026" }))).toEqual(["fechaPago"]);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, fechaPago: HOY }).success).toBe(true);
    // SIN ventana hacia atras: una tienda paga hoy una deuda de hace meses (D3 / A9 descartada).
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, fechaPago: "2026-01-15" }).success).toBe(true);
    const { fechaPago: _f, ...sinFecha } = BASE;
    void _f;
    expect(campos(registrarAbonoTiendaSchema.safeParse(sinFecha))).toEqual(["fechaPago"]);
  });

  it("R10 (forma): la tienda tiene que ser un uuid", () => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, tiendaId: "nuform" }))).toEqual(["tiendaId"]);
    const { tiendaId: _t, ...sinTienda } = BASE;
    void _t;
    expect(campos(registrarAbonoTiendaSchema.safeParse(sinTienda))).toEqual(["tiendaId"]);
  });

  it("R12: una clave no prevista -> error de validacion (ni el monto de la caja, ni una categoria, ni un saldo)", () => {
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, categoria: "ajuste_credito" }).success).toBe(false);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, saldo: "0.00" }).success).toBe(false);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, fecha: "2026-09-20" }).success).toBe(false);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, beneficiario: "x" }).success).toBe(false);
  });

  it("R13: sin clave de idempotencia, o con una que no es uuid -> claveIdempotencia", () => {
    const { claveIdempotencia: _c, ...sinClave } = BASE;
    void _c;
    expect(campos(registrarAbonoTiendaSchema.safeParse(sinClave))).toEqual(["claveIdempotencia"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, claveIdempotencia: "doble-clic" }))).toEqual(["claveIdempotencia"]);
  });

  it("el metodo es uno de los tres del catalogo", () => {
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, metodo: "cheque" }))).toEqual(["metodo"]);
    for (const metodo of ["efectivo", "SINPE", "transferencia"]) {
      expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, metodo }).success, metodo).toBe(true);
    }
  });

  it("R26: un comprobante de tipo no admitido o de mas de 4 MB -> comprobante; uno valido o ninguno entran (R30)", () => {
    const archivo = (type: string, size: number) => ({ type, size, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, comprobante: archivo("image/gif", 10) }))).toEqual(["comprobante"]);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, comprobante: archivo("application/pdf", 4 * 1024 * 1024 + 1) }))).toEqual(["comprobante"]);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, comprobante: archivo("application/pdf", 1000) }).success).toBe(true);
    expect(registrarAbonoTiendaSchema.safeParse({ ...BASE, comprobante: archivo("image/webp", 1000) }).success).toBe(true);
    expect(campos(registrarAbonoTiendaSchema.safeParse({ ...BASE, comprobante: "no-es-archivo" }))).toEqual(["comprobante"]);
    expect(registrarAbonoTiendaSchema.safeParse(BASE).success).toBe(true);
  });
});

describe("457 — anularAbonoTiendaSchema (R34/R35)", () => {
  const OK = { abonoId: "7f1c2d3e-0000-4000-8000-00000000000c", motivo: "Referencia equivocada" };
  it("R35: motivo vacio tras recortar -> rechazado; con motivo entra", () => {
    expect(anularAbonoTiendaSchema.safeParse({ ...OK, motivo: "  " }).success).toBe(false);
    expect(anularAbonoTiendaSchema.safeParse(OK).success).toBe(true);
  });
  it("R34: un monto, o cualquier otra clave, en la anulacion -> rechazado (el monto lo lee el servidor del documento)", () => {
    expect(anularAbonoTiendaSchema.safeParse({ ...OK, monto: "1.00" }).success).toBe(false);
    expect(anularAbonoTiendaSchema.safeParse({ ...OK, tiendaId: OK.abonoId }).success).toBe(false);
    expect(anularAbonoTiendaSchema.safeParse({ ...OK, abonoId: "no-uuid" }).success).toBe(false);
  });
});

describe("457 — obtenerComprobanteAbonoSchema (R42)", () => {
  it("un uuid entra; una clave de mas o un id que no es uuid, no", () => {
    expect(obtenerComprobanteAbonoSchema.safeParse({ abonoId: "7f1c2d3e-0000-4000-8000-00000000000c" }).success).toBe(true);
    expect(obtenerComprobanteAbonoSchema.safeParse({ abonoId: "x" }).success).toBe(false);
    expect(obtenerComprobanteAbonoSchema.safeParse({ abonoId: "7f1c2d3e-0000-4000-8000-00000000000c", tiendaId: "y" }).success).toBe(false);
  });
});
