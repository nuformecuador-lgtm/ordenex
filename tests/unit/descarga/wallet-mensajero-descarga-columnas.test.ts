import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_MIS_PAGOS,
  filaDescargaMiPago,
} from "@/app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas";
import {
  COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
  filaDescargaDesgloseMensajero,
} from "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";

// Feature 170 / T C.3 (R5/R7/R8/R23) — columnas de export de los DOS ledgers del pago por
// mensajero: la vista propia (`/mis-pagos`) y el desglose del admin (`/wallet/mensajeros`).
//
// Se prueban juntos y con el MISMO fixture a propósito: son dos módulos separados (dos
// superficies con alcances distintos), pero pintan la misma tabla, así que si sus filas
// dejaran de coincidir sería porque alguien cambió una y olvidó la otra. El último test de
// este archivo lo comprueba explícitamente.

const MOV: PagoMensajeroMovimientoDTO = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  mensajeroId: "1f2e3d4c-5b6a-4978-8b7c-6d5e4f3a2b1c",
  tipo: "pago",
  categoria: "pago_efectivo",
  monto: "10203040506.07",
  origenTipo: "cierre_dia",
  origenId: "4d3c2b1a-9876-4543-a210-fedcba987654",
  descripcion: "Cierre del 12 de julio",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

const LEDGERS = [
  {
    nombre: "mis pagos (mensajero)",
    columnas: COLUMNAS_DESCARGA_MIS_PAGOS,
    fila: filaDescargaMiPago,
  },
  {
    nombre: "desglose por cierre (admin)",
    columnas: COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
    fila: filaDescargaDesgloseMensajero,
  },
] as const;

describe.each(LEDGERS)("columnas de descarga del ledger: $nombre", ({ columnas, fila }) => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(columnas.map((c) => c.clave)).toEqual([
      "fecha",
      "tipo",
      "concepto",
      "monto",
      "origen",
    ]);
    expect(columnas.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Tipo",
      "Concepto",
      "Monto",
      "Origen",
    ]);
  });

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

describe("paridad entre los dos ledgers del pago por mensajero", () => {
  it("las dos vistas de la misma tabla proyectan la MISMA fila", () => {
    // Son módulos distintos porque son superficies con alcances distintos, pero la tabla que
    // pintan es la misma. Si un día divergen, que sea porque alguien lo decidió aquí.
    expect(filaDescargaMiPago(MOV)).toEqual(filaDescargaDesgloseMensajero(MOV));
    expect(COLUMNAS_DESCARGA_MIS_PAGOS).toEqual(COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO);
  });
});
