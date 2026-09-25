import { describe, it, expect } from "vitest";

import { anularCobroTiendaSchema } from "@/lib/types/wallet-tienda";

/**
 * FICHA 461 / T B.9 (R13, R14) — el BORDE de la anulacion de un cobro de Ordenex a una tienda.
 *
 * Lo que este archivo prueba es la BARRERA: el monto de los contra-asientos se lee del cobro en el
 * servidor, asi que una peticion que traiga `monto` —o cualquier otra clave— muere aqui, y un motivo
 * vacio tambien. Sin escribir nada, porque no llega al servicio.
 */

const COBRO = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";

describe("461/B.9 (R13/R14) — `anularCobroTiendaSchema`", () => {
  it("acepta el cobro y un motivo, recortando el motivo", () => {
    const r = anularCobroTiendaSchema.safeParse({ cobroId: COBRO, motivo: "  Se cobro dos veces  " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({ cobroId: COBRO, motivo: "Se cobro dos veces" });
  });

  it("R14: un motivo vacio o solo espacios NO pasa", () => {
    expect(anularCobroTiendaSchema.safeParse({ cobroId: COBRO, motivo: "" }).success).toBe(false);
    expect(anularCobroTiendaSchema.safeParse({ cobroId: COBRO, motivo: "   " }).success).toBe(false);
    expect(anularCobroTiendaSchema.safeParse({ cobroId: COBRO }).success).toBe(false);
  });

  it("R13: un `monto` colado en la peticion la tumba entera (`.strict()`)", () => {
    // Es EL requisito: el monto de los contra-asientos se lee DEL COBRO, y el cliente no tiene por
    // donde dictarlo. Sin `.strict()` la clave se ignoraria en silencio y este caso pasaria igual
    // que si el servidor la hubiera usado: por eso se afirma el rechazo, no la ausencia.
    const r = anularCobroTiendaSchema.safeParse({ cobroId: COBRO, motivo: "x", monto: "1.00" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
  });

  it("R13: cualquier otra clave no prevista tambien (`tiendaId`, `categoria`, `fecha`)", () => {
    for (const extra of [{ tiendaId: COBRO }, { categoria: "ajuste_credito" }, { fecha: "2026-09-01" }]) {
      expect(anularCobroTiendaSchema.safeParse({ cobroId: COBRO, motivo: "x", ...extra }).success).toBe(false);
    }
  });

  it("el cobro tiene que ser un uuid", () => {
    expect(anularCobroTiendaSchema.safeParse({ cobroId: "no-es-uuid", motivo: "x" }).success).toBe(false);
    expect(anularCobroTiendaSchema.safeParse({ cobroId: "", motivo: "x" }).success).toBe(false);
  });

  it("la forma es EXACTAMENTE dos claves: `cobroId` y `motivo`", () => {
    // El contrato del borde, escrito a mano: si alguien anade una clave (un monto, una fecha), esto
    // obliga a pasar por aqui.
    expect(Object.keys(anularCobroTiendaSchema.shape).sort()).toEqual(["cobroId", "motivo"]);
  });
});
