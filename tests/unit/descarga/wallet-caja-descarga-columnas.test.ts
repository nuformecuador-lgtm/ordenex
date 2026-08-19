import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 170 / T C.3 (R5/R7/R8/R23) — columnas de export del libro de caja principal.

const MOV: WalletMovimientoDTO = {
  id: "4f6a2b1c-8d3e-4f5a-9b7c-0d1e2f3a4b5c",
  tipo: "egreso",
  categoria: "egreso_gasto_fijo",
  monto: "12345678901.99",
  origenTipo: "gasto",
  origenId: "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d",
  descripcion: "Alquiler de bodega",
  registradoPor: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio", // feature 231 (R31): un gasto fijo es dinero de Ordenex
};

describe("columnas de descarga del libro de caja", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    // ── POR QUÉ ESTE LITERAL SE QUEDA, si el de la 173 hubo que quitarlo ──
    //
    // A simple vista son el mismo patrón —una lista de columnas fijada con `toEqual`— y la
    // feature 231 tuvo que desmontar el otro (D1, firmada). No son lo mismo, y la diferencia
    // está en QUÉ fija cada uno:
    //
    //  · El de D1 (`tests/components/descarga/WalletDescarga.test.tsx`) fijaba CUÁNTAS
    //    columnas puede tener la PANTALLA. Su caso decía afirmar otra cosa —que las categorías
    //    nuevas de la 173 no añaden ni quitan columnas—, así que el orden y el número se le
    //    colaron de polizón por usar `toEqual` sobre el array. Y un polizón sobre el diseño del
    //    libro acaba gobernando a features ajenas: bloqueó el reordenado de columnas de la 200
    //    y habría bloqueado la columna «Dueño» de la 231. Por eso se sustituyó por lo que su
    //    propio caso dice afirmar.
    //
    //  · ÉSTE fija el CONTRATO DEL ARCHIVO que se descarga, que es un artefacto que alguien
    //    abre FUERA de la app —una hoja de cálculo de caja que se archiva, se compara con la
    //    del mes pasado y se pega en un correo—. Que sus columnas cambien en silencio es
    //    exactamente lo que no debe pasar. Aquí el literal ES lo que el caso quiere afirmar, no
    //    un polizón: quien añada, quite o mueva una columna del archivo tiene que venir a esta
    //    línea y decirlo, y ese trámite es el punto.
    //
    //  · Y no se sustituye por una comparación contra `COLUMNAS_DESCARGA_WALLET_CAJA` porque
    //    eso sería comparar la lista CONSIGO MISMA: una aserción contra su propia fuente, que
    //    no puede ponerse roja nunca. Sería más débil, no más fuerte.
    //
    // Feature 231 (T5.3, R34/R35): «dueno» se AÑADE al final, que es donde la tabla la pinta
    // —la última de los datos, antes de «Acciones»—. Ninguna de las cinco anteriores se mueve
    // ni se quita, que es exactamente lo que este caso viene afirmando desde la 170: las
    // columnas están ENUMERADAS y en el ORDEN de la pantalla.
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave)).toEqual([
      "fecha",
      "tipo",
      "categoria",
      "monto",
      "origen",
      "dueno",
    ]);
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Tipo",
      "Categoría",
      "Monto",
      "Origen",
      "Dueño",
    ]);
  });

  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (R7)", () => {
    const fila = filaDescargaMovimientoCaja(MOV);
    // El STRING exacto que devolvió el servidor: ni parseFloat, ni redondeo, ni símbolo.
    expect(fila.monto).toBe("12345678901.99");
    expect(typeof fila.monto).toBe("string");
    expect(String(fila.monto)).not.toContain("₡");
    // Y por qué importa: un `Number(...)` intermedio ni siquiera conserva los CÉNTIMOS.
    // "1000.10" volvería como "1000.1" y la columna de dinero dejaría de cuadrar sola.
    expect(filaDescargaMovimientoCaja({ ...MOV, monto: "1000.10" }).monto).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite tipo y categoria como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const fila = filaDescargaMovimientoCaja(MOV);
    expect(fila.tipo).toBe("Egreso");
    expect(fila.categoria).toBe("Gasto fijo");
    expect(fila.tipo).not.toBe("egreso");
    expect(fila.categoria).not.toBe("egreso_gasto_fijo");
  });

  it("compone el origen igual que la tabla: etiqueta y descripcion (R8/R24)", () => {
    expect(filaDescargaMovimientoCaja(MOV).origen).toBe("Gasto · Alquiler de bodega");

    const sinDescripcion = { ...MOV, descripcion: null };
    expect(filaDescargaMovimientoCaja(sinDescripcion).origen).toBe("Gasto");
  });

  it("emite la fecha como dia calendario, igual que la tabla (R11/R24)", () => {
    expect(filaDescargaMovimientoCaja(MOV).fecha).toBe("2026-07-12");
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(filaDescargaMovimientoCaja(MOV))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("no expone identificadores internos: ni el del movimiento, ni el origen, ni el actor (R23)", () => {
    const fila = filaDescargaMovimientoCaja(MOV);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("origenId");
    expect(fila).not.toHaveProperty("registradoPor");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });
});
