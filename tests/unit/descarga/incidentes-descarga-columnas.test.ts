import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_INCIDENTES_HISTORICO,
  COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES,
} from "@/app/(app)/incidentes/_components/incidentes-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas de los archivos descargables de la cola de
// incidentes (feature 170, T E.6 / R5).
//
// Aquí el orden no es solo cosmética: la cola y el histórico comparten cuatro claves
// (`numRemision`, `destinatario`, `causa`, `estado`/`zona`) y una permuta entre ellas
// produce un archivo que se sigue leyendo «bien» y dice otra cosa. Las dos listas se
// escriben A MANO, nunca derivadas de la constante.

describe("orden de las columnas de descarga de los incidentes", () => {
  it("la COLA de pendientes declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES.map((c) => c.clave)).toEqual([
      "numRemision",
      "numGuia",
      "destinatario",
      "zona",
      "causa",
      "reportadoPor",
      "fecha",
    ]);
    expect(COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES.map((c) => c.encabezado)).toEqual([
      "Nº Remisión",
      "Nº Guía",
      "Destinatario",
      "Zona",
      "Causa",
      "Reportado por",
      "Fecha",
    ]);
  });

  it("el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_INCIDENTES_HISTORICO.map((c) => c.clave)).toEqual([
      "estado",
      "numRemision",
      "destinatario",
      "causa",
      "indemnizacion",
      "resueltoPor",
      "fechaResuelta",
      "motivo",
    ]);
    expect(COLUMNAS_DESCARGA_INCIDENTES_HISTORICO.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Nº Remisión",
      "Destinatario",
      "Causa",
      "Indemnización",
      "Resuelto por",
      "Fecha resuelta",
      "Motivo",
    ]);
  });
});
