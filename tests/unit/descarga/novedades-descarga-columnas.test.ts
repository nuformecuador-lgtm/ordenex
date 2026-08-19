import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_NOVEDADES,
  filaDescargaNovedad,
  SIN_CAUSA_REGISTRADA,
} from "@/app/(app)/novedades/_components/novedades-descarga-columnas";
import type { NovedadDTO } from "@/lib/types/novedad";

// 2026-08-14 (pedido humano) — columnas de export del listado de NOVEDADES (las devoluciones de
// la tienda). Lo que fijan estos casos: el orden de las columnas (contrato del archivo), que los
// valores salgan CRUDOS y que la causa viaje como etiqueta ES y nunca como el slug del enum.

const NOVEDAD: NovedadDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "devuelta",
  intentosContacto: 0,
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  direccion: "Av. Central 120, portón verde",
  producto: "Zapatos",
  peso: 1.5,
  montoCobrar: 24500,
  latitud: 9.9281,
  longitud: -84.0907,
  notas: "Llamar antes de llegar",
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
  causa: "not_found",
  intentosEntrega: 2,
};

describe("columnas de descarga del listado de novedades", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla", () => {
    expect(COLUMNAS_DESCARGA_NOVEDADES.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "telefono",
      "direccion",
      "ubicacion",
      "producto",
      "montoCobrar",
      "causa",
      "intentos",
    ]);
    expect(COLUMNAS_DESCARGA_NOVEDADES.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Teléfono",
      "Dirección",
      "Ubicación",
      "Producto",
      "Monto a cobrar",
      "Causa de devolución",
      "Intentos de entrega",
    ]);
  });

  it("la fila trae EXACTAMENTE las claves declaradas, sin sobrantes ni ausentes", () => {
    expect(Object.keys(filaDescargaNovedad(NOVEDAD)).sort()).toEqual(
      COLUMNAS_DESCARGA_NOVEDADES.map((c) => c.clave).sort(),
    );
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos", () => {
    for (const [clave, celda] of Object.entries(filaDescargaNovedad(NOVEDAD))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("la causa sale como ETIQUETA ES, nunca como el slug del enum", () => {
    expect(filaDescargaNovedad(NOVEDAD).causa).toBe("Cliente no localizado");
    expect(filaDescargaNovedad({ ...NOVEDAD, causa: "wrong_address" }).causa).toBe(
      "Dirección errada",
    );
    // Sin gestion vigente el archivo dice lo MISMO que la card dice en pantalla.
    expect(filaDescargaNovedad({ ...NOVEDAD, causa: null }).causa).toBe(SIN_CAUSA_REGISTRADA);
  });

  it("los ausentes son celda VACIA, no el placeholder de presentacion de la card", () => {
    const fila = filaDescargaNovedad({ ...NOVEDAD, numGuia: null, direccion: null, montoCobrar: null });
    expect(fila.numGuia).toBeNull();
    expect(fila.direccion).toBeNull();
    expect(fila.montoCobrar).toBeNull();
  });

  it("el `0` de intentos es un dato, y el campo ausente cae a 0", () => {
    expect(filaDescargaNovedad({ ...NOVEDAD, intentosEntrega: 0 }).intentos).toBe(0);
    const sinCampo: NovedadDTO = { ...NOVEDAD };
    delete sinCampo.intentosEntrega; // opcional en el contrato: la fila no puede romperse sin el
    expect(filaDescargaNovedad(sinCampo).intentos).toBe(0);
  });

  it("no publica lo que la pantalla no ensena: ni uuid, ni coordenadas, ni estatus", () => {
    const fila = filaDescargaNovedad(NOVEDAD);
    const valores = Object.values(fila);
    expect(valores).not.toContain(NOVEDAD.id);
    expect(valores).not.toContain(NOVEDAD.latitud);
    expect(valores).not.toContain(NOVEDAD.longitud);
    expect(valores).not.toContain(NOVEDAD.estatusValue);
    // La tienda es SIEMPRE la del actor: una columna con el mismo valor en todas las filas.
    expect(valores).not.toContain(NOVEDAD.tiendaNombre);
  });

  it("compone la ubicacion en una linea y tolera el distrito ausente", () => {
    expect(filaDescargaNovedad(NOVEDAD).ubicacion).toBe(
      "GAM Oeste · San José · Escazú · San Rafael",
    );
    expect(filaDescargaNovedad({ ...NOVEDAD, distritoNombre: null }).ubicacion).toBe(
      "GAM Oeste · San José · Escazú",
    );
  });
});
