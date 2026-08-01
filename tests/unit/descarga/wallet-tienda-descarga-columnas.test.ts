import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_MI_WALLET,
  filaDescargaMiWallet,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

// Feature 170 / T C.3 (R5/R7/R8/R23) — columnas de export del ledger de la tienda.

const MOV: WalletTiendaMovimientoDTO = {
  id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  tiendaId: "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b",
  tipo: "credito",
  categoria: "cod_recaudado",
  monto: "98765432109.87",
  origenTipo: "cierre_dia",
  origenId: "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918",
  descripcion: "Cierre del 12 de julio",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

describe("columnas de descarga del ledger de la tienda", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_MI_WALLET.map((c) => c.clave)).toEqual([
      "fecha",
      "tipo",
      "concepto",
      "monto",
      "origen",
    ]);
    expect(COLUMNAS_DESCARGA_MI_WALLET.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Tipo",
      "Concepto",
      "Monto",
      "Origen",
    ]);
  });

  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (R7)", () => {
    const fila = filaDescargaMiWallet(MOV);
    expect(fila.monto).toBe("98765432109.87");
    expect(typeof fila.monto).toBe("string");
    expect(String(fila.monto)).not.toContain("₡");
    // Y por qué importa: un `Number(...)` intermedio ni siquiera conserva los CÉNTIMOS.
    expect(filaDescargaMiWallet({ ...MOV, monto: "1000.10" }).monto).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite tipo y concepto como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const fila = filaDescargaMiWallet(MOV);
    expect(fila.tipo).toBe("Crédito");
    expect(fila.concepto).toBe("COD recaudado");
    expect(fila.concepto).not.toBe("cod_recaudado");
  });

  it("compone el origen igual que la tabla: etiqueta y descripcion (R8/R24)", () => {
    expect(filaDescargaMiWallet(MOV).origen).toBe("Cierre del día · Cierre del 12 de julio");

    const sinDescripcion = { ...MOV, descripcion: null };
    expect(filaDescargaMiWallet(sinDescripcion).origen).toBe("Cierre del día");
  });

  it("emite la fecha como dia calendario, igual que la tabla (R11/R24)", () => {
    expect(filaDescargaMiWallet(MOV).fecha).toBe("2026-07-12");
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(filaDescargaMiWallet(MOV))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("no expone identificadores internos: ni el del movimiento, ni la tienda, ni el origen (R23)", () => {
    const fila = filaDescargaMiWallet(MOV);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("tiendaId");
    expect(fila).not.toHaveProperty("origenId");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });
});
