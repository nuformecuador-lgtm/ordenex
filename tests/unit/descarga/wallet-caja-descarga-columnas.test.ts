import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
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
  documento: null, // ficha 459 (design §7.3): fila sin documento
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
    // Feature 231 (T5.3, R34/R35): «dueno» se AÑADIÓ al final, que es donde la tabla la pintaba.
    //
    // FICHA 458-E (T E.1, design §5.2; R3, R55–R57) — CONTRATO NUEVO, escrito a mano y a propósito:
    // el archivo sigue el orden de la tabla nueva (Fecha · Movimiento y motivo · A quién · Monto ·
    // Registró), con el concepto y el motivo en dos columnas y la dirección, el monto y el dueño en
    // tres (una hoja se filtra y se suma por columna). Las seis claves de antes se CONSERVAN y
    // entran `aQuien` y `registro`. Sustituye al literal de la 170/231 (listado en impl_458-E.md).
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave)).toEqual([
      "fecha",
      "categoria",
      "origen",
      "aQuien",
      "tipo",
      "monto",
      "dueno",
      "registro",
    ]);
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Motivo y origen",
      "A quién",
      "Entra o sale",
      "Monto",
      "Dueño",
      "Registró",
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
    // FICHA 458-E (R55): la dirección se dice «Entra» / «Sale», como el filtro y la tabla.
    expect(fila.tipo).toBe("Sale");
    expect(fila.categoria).toBe("Gasto fijo de Ordenex");
    expect(fila.tipo).not.toBe("egreso");
    expect(fila.categoria).not.toBe("egreso_gasto_fijo");
  });

  it("compone el origen igual que la tabla: etiqueta y descripcion (R8/R24)", () => {
    expect(filaDescargaMovimientoCaja(MOV).origen).toBe("Gasto o sueldo registrado a mano · Alquiler de bodega");

    const sinDescripcion = { ...MOV, descripcion: null };
    expect(filaDescargaMovimientoCaja(sinDescripcion).origen).toBe("Gasto o sueldo registrado a mano");
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

  it("458-E R56/R57/R3: «A quién» y «Registró» con los textos de la tabla, nunca un id", () => {
    const autoria: AutoriaDeFilaDTO = {
      movimientoId: MOV.id,
      aQuien: {
        nombre: "Tania Tienda",
        beneficiario: "Facebook",
        // El id de la cuenta viaja para el ENLACE de la pantalla; en la hoja no puede salir.
        cuenta: { tipo: "tienda", id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
        esOrdenex: false,
      },
      registro: { nombre: "Ana Maestra", automatico: null },
    };
    const fila = filaDescargaMovimientoCaja(MOV, autoria);
    expect(fila.aQuien).toBe("Tania Tienda · a Facebook");
    expect(fila.registro).toBe("Ana Maestra");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }

    // Lo automático, con la acción y quien la decidió.
    const automatico = filaDescargaMovimientoCaja(MOV, {
      ...autoria,
      aQuien: { nombre: null, beneficiario: null, cuenta: null, esOrdenex: false },
      registro: { nombre: null, automatico: { accion: "plantilla_gasto_fijo", por: null } },
    });
    expect(automatico.aQuien).toBe("—");
    expect(automatico.registro).toBe("Automático · Plantilla de gasto fijo");

    // Sin autoría resuelta: «—», nunca el `registradoPor` crudo.
    const sin = filaDescargaMovimientoCaja(MOV);
    expect(sin.aQuien).toBe("—");
    expect(sin.registro).toBe("—");
  });
});
