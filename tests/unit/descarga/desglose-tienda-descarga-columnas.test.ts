import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_DESGLOSE_TIENDA,
  filaDescargaDesgloseTienda,
} from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
import * as modulo from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

// Feature 171 (T2.2, R41) — columnas de export del DESGLOSE de una tienda elegida.
//
// El archivo lo lee un humano que está liquidando dinero: tiene que traer lo que se ve en
// pantalla, con las mismas palabras, y nada que sea de la máquina (uuid, claves foráneas).

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

describe("columnas de descarga del desglose por tienda", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R15)", () => {
    expect(COLUMNAS_DESCARGA_DESGLOSE_TIENDA.map((c) => c.clave)).toEqual([
      "fecha",
      "tipo",
      "concepto",
      "monto",
      "origen",
    ]);
    expect(COLUMNAS_DESCARGA_DESGLOSE_TIENDA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Tipo",
      "Concepto",
      "Monto",
      "Origen",
    ]);
  });

  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (money-safe, R14/R23)", () => {
    const fila = filaDescargaDesgloseTienda(MOV);
    expect(fila.monto).toBe("98765432109.87");
    expect(typeof fila.monto).toBe("string");
    expect(String(fila.monto)).not.toContain("₡");
    // Por qué importa: un `Number(...)` intermedio ni siquiera conserva los CÉNTIMOS.
    expect(filaDescargaDesgloseTienda({ ...MOV, monto: "1000.10" }).monto).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("conserva el signo de un monto negativo, que en un libro de dinero no es decoración", () => {
    expect(filaDescargaDesgloseTienda({ ...MOV, monto: "-452.00" }).monto).toBe("-452.00");
  });

  it("emite tipo y concepto como ETIQUETA LEGIBLE, no como valor interno (R20)", () => {
    const fila = filaDescargaDesgloseTienda(MOV);
    expect(fila.tipo).toBe("Crédito");
    expect(fila.concepto).toBe("COD recaudado");
    expect(fila.concepto).not.toBe("cod_recaudado");

    const iva = filaDescargaDesgloseTienda({
      ...MOV,
      tipo: "debito",
      categoria: "iva_comision_cod",
    });
    expect(iva.tipo).toBe("Débito");
    expect(iva.concepto).toBe("IVA de la comisión");
  });

  it("R43: un movimiento `pago_tienda` sale con su concepto propio, no plegado en otro", () => {
    // Hoy nadie emite esta categoría (la emitirá la 172), pero el archivo ya sabe nombrarla:
    // el día que existan pagos, la descarga los distingue de los cargos sin tocar nada.
    const pago = filaDescargaDesgloseTienda({
      ...MOV,
      tipo: "debito",
      categoria: "pago_tienda",
      origenTipo: "pago_tienda",
      descripcion: null,
      monto: "4000.00",
    });
    expect(pago.concepto).toBe("Pago a la tienda");
    expect(pago.origen).toBe("Pago a la tienda");
    expect(pago.monto).toBe("4000.00");
  });

  it("compone el origen igual que la tabla: etiqueta y descripción (R20)", () => {
    expect(filaDescargaDesgloseTienda(MOV).origen).toBe(
      "Cierre del día · Cierre del 12 de julio",
    );
    expect(filaDescargaDesgloseTienda({ ...MOV, descripcion: null }).origen).toBe(
      "Cierre del día",
    );
  });

  it("emite la fecha como día calendario, igual que la tabla (R15)", () => {
    expect(filaDescargaDesgloseTienda(MOV).fecha).toBe("2026-07-12");
  });

  it("emite valores CRUDOS: texto, número o celda vacía, nunca objetos", () => {
    for (const [clave, celda] of Object.entries(filaDescargaDesgloseTienda(MOV))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("R41: no expone identificadores internos — ni el del movimiento, ni la tienda, ni el origen", () => {
    const fila = filaDescargaDesgloseTienda(MOV);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("tiendaId");
    expect(fila).not.toHaveProperty("origenId");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
      }
    }
  });

  it("P4: el NOMBRE de la tienda no es columna — identifica al archivo, no a la fila", () => {
    expect(COLUMNAS_DESCARGA_DESGLOSE_TIENDA.map((c) => c.clave)).not.toContain("tienda");
  });

  it("el módulo exporta SOLO las columnas y la proyección (la guardia ejecuta todo lo demás)", () => {
    // La guardia de datos sensibles invoca con una sonda TODA función exportada por un
    // `*-descarga-columnas.ts`. Un tercer export que no fuera una proyección la rompería,
    // y el fallo se leería como un falso positivo de datos sensibles.
    expect(Object.keys(modulo).sort()).toEqual([
      "COLUMNAS_DESCARGA_DESGLOSE_TIENDA",
      "filaDescargaDesgloseTienda",
    ]);
  });
});
