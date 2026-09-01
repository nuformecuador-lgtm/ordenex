import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO,
  filaDescargaDetalleMovimiento,
} from "@/app/(app)/wallet/_components/detalle-movimiento-descarga-columnas";
import * as modulo from "@/app/(app)/wallet/_components/detalle-movimiento-descarga-columnas";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

// Ficha 344 (T8.1, R35/R36/R37) — columnas de EXPORT del detalle de una fila del libro de la
// CAJA PRINCIPAL: las órdenes que componen el importe de ese movimiento.
//
// El archivo lo lee un humano que está cuadrando dinero: tiene que traer lo que se ve en
// pantalla, con las mismas palabras, y nada que sea de la máquina (uuid, claves foráneas). Y el
// aporte tiene que poder SUMARSE en la hoja de cálculo, que es lo que quien lo descarga va a
// hacer para cotejarlo con el importe de la fila.

const ORDEN: OrdenAporteDTO = {
  ordenId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  guia: "48127",
  destinatario: "María Fernández",
  tiendaNombre: "Tienda Central",
  resultados: ["entregada"],
  aporte: "98765432109.87",
};

describe("columnas de descarga del detalle de un movimiento de la caja", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R35)", () => {
    // ⚠️ ESTAS DOS LISTAS SE ESCRIBEN Y SE ACTUALIZAN A MANO. NO se derivan de
    // `COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO`: comparar la constante contra su propia fuente es
    // una aserción que no puede ponerse roja NUNCA, y en este repo ya está escrito lo que cuesta
    // (`literal: contrato o polizón`). Lo que un usuario descarga —qué columnas salen y en qué
    // orden— es contrato: si cambia, se cambia aquí deliberadamente.
    expect(COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO.map((c) => c.clave)).toEqual([
      "guia",
      "destinatario",
      "tienda",
      "resultado",
      "aporte",
    ]);
    expect(COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO.map((c) => c.encabezado)).toEqual([
      "Guía",
      "Destinatario",
      "Tienda",
      "Resultado",
      "Aporte",
    ]);
  });

  it("emite el aporte TAL CUAL, sin recalcularlo ni adornarlo (money-safe, R37)", () => {
    const fila = filaDescargaDetalleMovimiento(ORDEN);
    expect(fila.aporte).toBe("98765432109.87");
    expect(typeof fila.aporte).toBe("string");
    // Sin símbolo de moneda: el colón convertiría una celda numérica en texto que la hoja de
    // cálculo no puede sumar, y sumar esta columna es justo lo que hace quien la descarga.
    expect(String(fila.aporte)).not.toContain("₡");
    // Por qué importa: un `Number(...)` intermedio ni siquiera conserva los CÉNTIMOS.
    expect(filaDescargaDetalleMovimiento({ ...ORDEN, aporte: "1000.10" }).aporte).toBe(
      "1000.10",
    );
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("un aporte de 0,00 sale como «0.00» y no como celda vacía", () => {
    // La supresión de los ceros la hace el `WHERE` del servidor, no este archivo. Cuando un cero
    // llega igual —la tarifa congelada valía cero, el caso que el backend dejó declarado— la
    // celda dice «0.00»: una celda vacía se leería como «no hay dato».
    expect(filaDescargaDetalleMovimiento({ ...ORDEN, aporte: "0.00" }).aporte).toBe("0.00");
  });

  it("emite el resultado como ETIQUETA LEGIBLE, nunca como valor del enum (R13)", () => {
    expect(filaDescargaDetalleMovimiento(ORDEN).resultado).toBe("Entregada");
    expect(filaDescargaDetalleMovimiento(ORDEN).resultado).not.toBe("entregada");
    expect(
      filaDescargaDetalleMovimiento({ ...ORDEN, resultados: ["rechazada"] }).resultado,
    ).toBe("Rechazada");
  });

  it("R20: una orden con DOS gestiones en el cierre nombra las dos en su celda", () => {
    // El grano de la fila es la ORDEN, así que las dos gestiones vienen en la misma celda. Sin
    // esto, el archivo diría «Entregada» de una orden que además fue reprogramada, y quien lo
    // cotejara no entendería de dónde sale su aporte.
    expect(
      filaDescargaDetalleMovimiento({
        ...ORDEN,
        resultados: ["entregada", "reprogramada"],
      }).resultado,
    ).toBe("Entregada · Reprogramada");
  });

  it("R14: la tienda SÍ es columna en la caja principal, con su nombre congelado", () => {
    expect(filaDescargaDetalleMovimiento(ORDEN).tienda).toBe("Tienda Central");
  });

  it("emite valores CRUDOS: texto, número o celda vacía, nunca objetos", () => {
    for (const [clave, celda] of Object.entries(filaDescargaDetalleMovimiento(ORDEN))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("R36: no expone ningún identificador interno — ni el de la orden", () => {
    const fila = filaDescargaDetalleMovimiento(ORDEN);
    expect(fila).not.toHaveProperty("ordenId");
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("movimientoId");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
      }
    }
  });

  it("el módulo exporta SOLO las columnas y la proyección (la guardia ejecuta todo lo demás)", () => {
    // La guardia de datos sensibles invoca con una sonda TODA función exportada por un
    // `*-descarga-columnas.ts`. Un tercer export que no fuera una proyección la rompería, y el
    // fallo se leería como un falso positivo de datos sensibles.
    expect(Object.keys(modulo).sort()).toEqual([
      "COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO",
      "filaDescargaDetalleMovimiento",
    ]);
  });
});
