import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_SATELITE } from "@/app/(app)/recepcion-satelite/_components/satelite-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas del archivo descargable del listado de la
// bodega satélite (feature 170, T A.2 / R5).
//
// Trece columnas, y cuatro de ellas son la jerarquía geográfica (zona, provincia, cantón,
// distrito): son el caso de libro de una permuta que NADIE nota leyendo el archivo, porque
// las cuatro celdas llevan nombres de lugar. El esperado se escribe A MANO.

describe("orden de las columnas de descarga del listado de la bodega satélite", () => {
  it("declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_SATELITE.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "estatus",
      "intentos",
      "destinatario",
      "producto",
      "direccion",
      "tienda",
      "zona",
      "provincia",
      "canton",
      "distrito",
      "montoCobrar",
    ]);
    expect(COLUMNAS_DESCARGA_SATELITE.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Intentos",
      "Destinatario",
      "Producto",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
    ]);
  });
});
