import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
  filaDescargaDesgloseMensajero,
} from "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";

// Feature 170 / T C.3 (R5/R7/R8/R23) — columnas de export del ledger del pago por mensajero
// que queda: el desglose del admin (`/wallet/mensajeros`).
//
// Ficha 336 (2026-08-30): eran DOS ledgers. La vista propia (`/mis-pagos`) se borró por decisión
// humana, y con ella `COLUMNAS_DESCARGA_MIS_PAGOS`/`filaDescargaMiPago`, su entrada de `LEDGERS`
// y el `describe` de PARIDAD entre los dos (sin dos, no hay paridad que afirmar). Lo que NO se
// toca es el `it` que NOMBRA `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`: es lo que mantiene a esa
// constante fuera del censo de «constante sin aserción de orden» de
// `columnas-asercion-de-orden.guardia`.

const MOV: PagoMensajeroMovimientoDTO = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  mensajeroId: "1f2e3d4c-5b6a-4978-8b7c-6d5e4f3a2b1c",
  tipo: "pago",
  categoria: "pago_efectivo",
  monto: "10203040506.07",
  origenTipo: "cierre_dia",
  origenId: "4d3c2b1a-9876-4543-a210-fedcba987654",
  // feature 205/R43: el DTO lo lleva; la DESCARGA no lo emite (y este archivo mide justo eso:
  // ningun uuid sobrevive a la proyeccion).
  cierreId: "4d3c2b1a-9876-4543-a210-fedcba987654",
  descripcion: "Cierre del 12 de julio",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

const LEDGERS = [
  {
    nombre: "desglose por cierre (admin)",
    columnas: COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
    fila: filaDescargaDesgloseMensajero,
  },
] as const;

// El ORDEN se afirma FUERA del `describe.each`, un caso por constante y NOMBRÁNDOLA.
//
// Estaba dentro, sobre el `columnas` del parámetro, y funcionaba —la permuta ponía rojo su
// caso, medido—. Pero ni un grep ni un detector de cobertura ven ahí una aserción sobre
// `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`: leen `columnas.map(...)`. La constante salía censada
// como «sin aserción de orden» teniéndola, y el que viniera a taparlo habría escrito un caso
// duplicado. Un caso explícito cuesta las mismas líneas y se deja encontrar.
//
// Lo demás —fila, monto, etiquetas, fecha, uuid— sigue parametrizado.

describe("orden de las columnas de descarga del ledger del pago por mensajero", () => {
  it("el DESGLOSE por cierre (admin) declara sus columnas en el orden de la pantalla (R5)", () => {
    // El listado escrito a mano a propósito: dice CUÁL es, que es lo que se rompería si alguien
    // reordenara o renombrara una columna del módulo de producción por descuido.
    expect(COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO.map((c) => c.clave)).toEqual([
      "fecha",
      "tipo",
      "concepto",
      "monto",
      "origen",
    ]);
    expect(COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Tipo",
      "Concepto",
      "Monto",
      "Origen",
    ]);
  });
});

describe.each(LEDGERS)("columnas de descarga del ledger: $nombre", ({ fila }) => {
  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (R7)", () => {
    const proyectada = fila(MOV);
    expect(proyectada.monto).toBe("10203040506.07");
    expect(typeof proyectada.monto).toBe("string");
    expect(String(proyectada.monto)).not.toContain("₡");
    // Y por qué importa: un `Number(...)` intermedio ni siquiera conserva los CÉNTIMOS.
    expect(fila({ ...MOV, monto: "1000.10" }).monto).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite tipo y concepto como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const proyectada = fila(MOV);
    expect(proyectada.tipo).toBe("Pago");
    expect(proyectada.concepto).toBe("Pago del efectivo");
    expect(proyectada.concepto).not.toBe("pago_efectivo");
  });

  it("compone el origen igual que la tabla: etiqueta y descripcion (R8/R24)", () => {
    expect(fila(MOV).origen).toBe("Cierre del día · Cierre del 12 de julio");
    expect(fila({ ...MOV, descripcion: null }).origen).toBe("Cierre del día");
  });

  it("emite la fecha como dia calendario, igual que la tabla (R11/R24)", () => {
    expect(fila(MOV).fecha).toBe("2026-07-12");
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(fila(MOV))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("no expone identificadores internos: ni el del movimiento, ni el mensajero, ni el origen (R23)", () => {
    const proyectada = fila(MOV);
    expect(proyectada).not.toHaveProperty("id");
    expect(proyectada).not.toHaveProperty("mensajeroId");
    expect(proyectada).not.toHaveProperty("origenId");
    for (const celda of Object.values(proyectada)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });
});
