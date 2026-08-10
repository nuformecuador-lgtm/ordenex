import { describe, it, expect } from "vitest";

import {
  columnasDeVistaFinanciera,
  filasDeVistaFinanciera,
} from "@/app/(app)/analitica/_components/export-financiero/export-financiero";

import { dtoTemporalConNeto, dtoTemporalSoloBruto } from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T2.3). R13.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// R13 es R23 de la 183 trasladado al archivo. Desde ⟨D12⟩ (humano, 2026-08-04) `ImporteAnalitico`
// es una UNION DISCRIMINADA por `forma`: `ingreso_flete`, `ingreso_comision_cod` e `ingreso_iva`
// publican SOLO bruto, y su `neto` no existe ni siquiera en `null` —leerlo NO COMPILA—.
//
// Por que la columna de neto tiene que DESAPARECER y no quedarse vacia: una celda ausente
// significa «no se sabe» (R15 de la 132) y aqui la verdad es **«no aplica»**. Un archivo que
// circula con una columna «Neto» vacia se lee como un dato que se perdio. `neto: importe.neto ??
// importe.bruto` seria peor todavia: publicaria el bruto disfrazado de neto.

describe("Feature 184 — analitica financiera: export de la serie (R13) · la forma del importe manda", () => {
  it("una vista solo_bruto no emite ninguna columna de neto", () => {
    const datos = dtoTemporalSoloBruto();
    const [vista] = datos.vistas;

    const columnas = columnasDeVistaFinanciera(vista!);
    expect(columnas.map((columna) => columna.clave)).not.toContain("neto");
    expect(columnas.some((columna) => /neto/i.test(columna.encabezado))).toBe(false);

    const filas = filasDeVistaFinanciera(datos, vista!);
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      // NI vacia, NI en cero, NI derivada del bruto: la clave NO EXISTE.
      expect(Object.keys(fila)).not.toContain("neto");
      expect("neto" in fila).toBe(false);
    }
    // Y las claves de la fila son EXACTAMENTE las columnas declaradas: si sobrara o faltara
    // alguna, el generador comun dejaria una celda vacia sin que nada lo dijera.
    expect(Object.keys(filas[0]!)).toEqual(columnas.map((columna) => columna.clave));
  });

  it("una vista bruto_y_neto emite las dos, distinguibles", () => {
    const datos = dtoTemporalConNeto();
    const [vista] = datos.vistas;

    const columnas = columnasDeVistaFinanciera(vista!);
    expect(columnas.map((columna) => columna.clave)).toContain("neto");

    const filas = filasDeVistaFinanciera(datos, vista!);
    expect(Object.keys(filas[0]!)).toEqual(columnas.map((columna) => columna.clave));

    for (const [indice, fila] of filas.entries()) {
      const original = vista!.filas[indice]!;
      if (original.importe.forma !== "bruto_y_neto") throw new Error("la fixture perdio el neto");
      expect(fila.bruto).toBe(original.importe.bruto);
      expect(fila.neto).toBe(original.importe.neto);
      // DISTINGUIBLES: la fixture da cifras distintas a proposito, para que una proyeccion que
      // copiara el bruto en el neto no pudiera acertar por casualidad.
      expect(fila.neto).not.toBe(fila.bruto);
    }
  });

  it("la eleccion del juego de columnas la hace la FORMA, no el id de la metrica (R14)", () => {
    // Contrapeso: las dos fixtures son metricas DISTINTAS, pero lo que separa sus columnas es la
    // forma de su importe. Se comprueba que el mismo par de funciones da respuestas distintas
    // para las dos sin que nadie les haya dicho como se llaman.
    const conNeto = dtoTemporalConNeto();
    const soloBruto = dtoTemporalSoloBruto();
    const clavesConNeto = columnasDeVistaFinanciera(conNeto.vistas[0]!).map((c) => c.clave);
    const clavesSoloBruto = columnasDeVistaFinanciera(soloBruto.vistas[0]!).map((c) => c.clave);

    expect(clavesConNeto.filter((clave) => !clavesSoloBruto.includes(clave))).toEqual(["neto"]);
  });
});
