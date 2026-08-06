import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_SALDOS_TIENDAS } from "@/app/(app)/wallet/tiendas/_components/saldos-tiendas-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas del archivo descargable de los saldos de
// tiendas (feature 170, T D.1 / R5).
//
// Es un archivo de DINERO: «Saldo a favor» dice de quién es el saldo, y esa palabra en el
// encabezado es la mitad del dato. Se fija el texto exacto, escrito a mano, no leído de la
// constante.

describe("orden de las columnas de descarga de los saldos de tiendas", () => {
  it("declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_SALDOS_TIENDAS.map((c) => c.clave)).toEqual([
      "tienda",
      "saldo",
      "estado",
    ]);
    expect(COLUMNAS_DESCARGA_SALDOS_TIENDAS.map((c) => c.encabezado)).toEqual([
      "Tienda",
      "Saldo a favor",
      "Estado",
    ]);
  });
});
