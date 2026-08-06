import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
} from "@/app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas de los archivos descargables de «Cierres del
// día» del admin (feature 170, T E.1 / R5).
//
// Por qué existe este archivo: hasta ahora lo único que fijaba estas columnas eran
// `toContain` de un encabezado suelto y aserciones sobre `filas[i].campo`, y las dos son
// INSENSIBLES AL ORDEN: reordenar o quitar una columna no ponía rojo ningún test, y lo que
// cambia es un archivo que un usuario descarga.
//
// Los valores esperados se escriben A MANO —nunca derivados de la propia constante, que
// sería una tautología que siempre pasa—. Los encabezados compartidos (`PAGO_MENSAJERO_COL`,
// `INGRESO_BODEGA_RECHAZOS_COL`) se fijan por su TEXTO: es el texto lo que llega al archivo.

describe("orden de las columnas de descarga de los cierres del día (admin)", () => {
  it("la COLA de pendientes declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_CIERRES_PENDIENTES.map((c) => c.clave)).toEqual([
      "estado",
      "mensajero",
      "fecha",
      "destino",
      "general",
      "pagoMensajero",
      "ingresoBodega",
    ]);
    expect(COLUMNAS_DESCARGA_CIERRES_PENDIENTES.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Mensajero",
      "Fecha",
      "Destino",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
    ]);
  });

  it("el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_CIERRES_HISTORICO.map((c) => c.clave)).toEqual([
      "estado",
      "mensajero",
      "fechaResuelta",
      "destino",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "motivo",
    ]);
    expect(COLUMNAS_DESCARGA_CIERRES_HISTORICO.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Mensajero",
      "Fecha resuelta",
      "Destino",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Motivo",
    ]);
  });
});
