import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO,
  filaDescargaDetalleMiMovimiento,
} from "@/app/(app)/mi-wallet/_components/detalle-mi-movimiento-descarga-columnas";
import * as modulo from "@/app/(app)/mi-wallet/_components/detalle-mi-movimiento-descarga-columnas";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

// Ficha 344 (T8.1, R35/R36/R37) — columnas de EXPORT del detalle de una fila del libro de LA
// PROPIA TIENDA. Gemelo del de la caja, con UNA columna menos: aquí no sale «Tienda» (R14),
// porque todas las órdenes del archivo son de la misma.

const ORDEN: OrdenAporteDTO = {
  ordenId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  guia: "48127",
  destinatario: "María Fernández",
  // Llega en el DTO y la proyección lo DESCARTA. Si algún día se colara, el caso de R14 cae.
  tiendaNombre: "Tienda Central",
  resultados: ["entregada"],
  aporte: "98765432109.87",
};

describe("columnas de descarga del detalle de un movimiento de la tienda", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R35)", () => {
    // ⚠️ ESTAS DOS LISTAS SE ESCRIBEN Y SE ACTUALIZAN A MANO. NO se derivan de
    // `COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO`: comparar la constante contra su propia fuente
    // es una aserción que no puede ponerse roja NUNCA.
    expect(COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO.map((c) => c.clave)).toEqual([
      "guia",
      "destinatario",
      "resultado",
      "aporte",
    ]);
    expect(COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO.map((c) => c.encabezado)).toEqual([
      "Guía",
      "Destinatario",
      "Resultado",
      "Aporte",
    ]);
  });

  it("R14: la tienda NO es columna — identifica al archivo, no a la fila", () => {
    expect(COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO.map((c) => c.clave)).not.toContain("tienda");
    expect(filaDescargaDetalleMiMovimiento(ORDEN)).not.toHaveProperty("tienda");
    // Y no se cuela por ninguna otra celda: el nombre de la tienda no aparece en el archivo.
    for (const celda of Object.values(filaDescargaDetalleMiMovimiento(ORDEN))) {
      expect(String(celda)).not.toContain("Tienda Central");
    }
  });

  it("emite el aporte TAL CUAL, sin recalcularlo ni adornarlo (money-safe, R37)", () => {
    const fila = filaDescargaDetalleMiMovimiento(ORDEN);
    expect(fila.aporte).toBe("98765432109.87");
    expect(typeof fila.aporte).toBe("string");
    expect(String(fila.aporte)).not.toContain("₡");
    expect(filaDescargaDetalleMiMovimiento({ ...ORDEN, aporte: "1000.10" }).aporte).toBe(
      "1000.10",
    );
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite el resultado como ETIQUETA LEGIBLE, nunca como valor del enum (R13)", () => {
    expect(filaDescargaDetalleMiMovimiento(ORDEN).resultado).toBe("Entregada");
    expect(filaDescargaDetalleMiMovimiento(ORDEN).resultado).not.toBe("entregada");
    expect(
      filaDescargaDetalleMiMovimiento({
        ...ORDEN,
        resultados: ["entregada", "reprogramada"],
      }).resultado,
    ).toBe("Entregada · Reprogramada");
  });

  it("emite valores CRUDOS: texto, número o celda vacía, nunca objetos", () => {
    for (const [clave, celda] of Object.entries(filaDescargaDetalleMiMovimiento(ORDEN))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("R36: no expone ningún identificador interno — ni el de la orden", () => {
    const fila = filaDescargaDetalleMiMovimiento(ORDEN);
    expect(fila).not.toHaveProperty("ordenId");
    expect(fila).not.toHaveProperty("id");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
      }
    }
  });

  it("el módulo exporta SOLO las columnas y la proyección (la guardia ejecuta todo lo demás)", () => {
    expect(Object.keys(modulo).sort()).toEqual([
      "COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO",
      "filaDescargaDetalleMiMovimiento",
    ]);
  });
});
