import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_MI_WALLET,
  filaDescargaMiWallet,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas";
import { filaDescargaDesgloseTienda } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
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

// ⭑ FICHA 381 (T I.2, R39) — EL COBRO EN LA DESCARGA DEL LIBRO DE LA TIENDA.
//
// R39 pide que el nombre del archivo sea el MISMO que el de pantalla, en las dos vistas. No se
// prueba comparando el archivo contra el diccionario del que sale —eso sería una aserción
// contra su propia fuente, siempre verde—: se prueba con el LITERAL que la tienda lee en la
// tabla, y se afirma además que la descarga del ADMINISTRADOR emite exactamente ese mismo
// texto para el mismo movimiento. Si alguien desviara una de las dos, la igualdad cruzada cae.
describe("⭑ FICHA 381 (R39) — el cobro sale en el archivo con el nombre de pantalla", () => {
  const COBRO: WalletTiendaMovimientoDTO = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    tipo: "debito",
    categoria: "cobro_manual",
    monto: "15000.00",
    origenTipo: "manual",
    origenId: null,
    descripcion: "Material de despacho entregado en bodega",
    fechaMovimiento: "2026-09-08T14:30:00.000Z",
  };

  it("la columna «Concepto» dice «Cobro de Ordenex», no el valor del enum", () => {
    const fila = filaDescargaMiWallet(COBRO);
    expect(fila.concepto).toBe("Cobro de Ordenex");
    expect(fila.concepto).not.toBe("cobro_manual");
    expect(fila.tipo).toBe("Débito");
  });

  it("emite el importe TAL CUAL y arrastra el motivo tecleado en la columna de origen", () => {
    const fila = filaDescargaMiWallet(COBRO);
    expect(fila.monto).toBe("15000.00");
    expect(typeof fila.monto).toBe("string");
    expect(fila.origen).toBe("Manual · Material de despacho entregado en bodega");
    expect(fila.fecha).toBe("2026-09-08");
  });

  it("las DOS descargas —la de la tienda y la del admin— emiten el mismo nombre", () => {
    // El archivo del administrador sale del MISMO diccionario reexportado. Si un día se
    // duplicara el mapa, esta igualdad sería lo primero en caer.
    expect(filaDescargaMiWallet(COBRO).concepto).toBe(
      filaDescargaDesgloseTienda(COBRO).concepto,
    );
    expect(filaDescargaMiWallet(COBRO).concepto).toBe("Cobro de Ordenex");
  });

  it("un cobro y un ajuste NO se confunden en el archivo (R33/D2)", () => {
    const ajuste = { ...COBRO, categoria: "ajuste_debito" as const };
    expect(filaDescargaMiWallet(ajuste).concepto).toBe("Ajuste (débito)");
    expect(filaDescargaMiWallet(COBRO).concepto).not.toBe(
      filaDescargaMiWallet(ajuste).concepto,
    );
  });
});
