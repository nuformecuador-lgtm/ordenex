import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
  COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
  COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
  COLUMNAS_DESCARGA_CONSOLIDABLES,
} from "@/app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas de los archivos descargables de las CUATRO
// tablas de cierre de bodega (feature 170, T E.2 y T E.3 / R5).
//
// Las cuatro se prueban una por una y NO con un `describe.each` compartido: precisamente lo
// que se fija es que sus juegos de columnas son DISTINTOS (la cola no tiene estado ni motivo,
// el histórico del maestro sí, y el del adminSatelite enseña la fecha de SOLICITUD). Un
// esperado común las volvería intercambiables, que es el error que este archivo caza.
//
// Los valores esperados se escriben A MANO, nunca derivados de la constante.

describe("orden de las columnas de descarga de los cierres de bodega", () => {
  it("la COLA de pendientes del maestro declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_PENDIENTES.map((c) => c.clave)).toEqual([
      "zona",
      "solicito",
      "fecha",
      "cierresDelDia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_PENDIENTES.map((c) => c.encabezado)).toEqual([
      "Zona",
      "Solicitó",
      "Fecha",
      "Cierres del día",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
    ]);
  });

  it("el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_RESUELTOS.map((c) => c.clave)).toEqual([
      "estado",
      "zona",
      "solicito",
      "fechaResuelta",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "motivo",
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_RESUELTOS.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Zona",
      "Solicitó",
      "Fecha resuelta",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Motivo",
    ]);
  });

  it("los cierres del día A CONSOLIDAR declaran sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_CONSOLIDABLES.map((c) => c.clave)).toEqual([
      "mensajero",
      "efectivo",
      "simpe",
      "transferencia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
    ]);
    expect(COLUMNAS_DESCARGA_CONSOLIDABLES.map((c) => c.encabezado)).toEqual([
      "Mensajero",
      "Efectivo",
      "SINPE",
      "Transferencia",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
    ]);
  });

  it("los cierres de bodega YA SOLICITADOS declaran sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_SOLICITADOS.map((c) => c.clave)).toEqual([
      "estado",
      "fechaSolicitud",
      "cierresDelDia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "motivo",
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_SOLICITADOS.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Fecha solicitud",
      "Cierres del día",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Motivo",
    ]);
  });
});
