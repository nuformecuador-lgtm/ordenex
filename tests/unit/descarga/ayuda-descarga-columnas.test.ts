import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_AYUDA,
  filaDescargaAyuda,
  TITULO_DESCARGA_AYUDA,
} from "@/app/(app)/novedades/_components/ayuda-descarga-columnas";
import {
  COLUMNAS_DESCARGA_NOVEDADES,
  SIN_CAUSA_REGISTRADA,
} from "@/app/(app)/novedades/_components/novedades-descarga-columnas";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 236 (T3.2, D3/R37/R39) — columnas de export de la pestaña «Ayuda solicitada».
//
// El caso que da sentido a este archivo entero es el segundo: **no existe la columna de causa**.
// Hasta el 2026-08-19 estas órdenes salían mezcladas en el archivo de devoluciones y esa columna
// decía «Sin causa registrada» sobre una orden que nunca se devolvió — no un hueco, una afirmación
// falsa con formato de dato. R26 prohíbe además ANUNCIAR la ausencia, así que no vale con dejarla
// vacía: la columna no está.

const EN_AYUDA: NovedadDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "ayuda_tienda",
  intentosContacto: 2,
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
  // El servicio emite `null` para este grupo y la consulta ni se hace (R26). Se pone aquí un valor
  // NO nulo a propósito: si alguien repusiera la columna, el archivo publicaría esta causa —que
  // vendría de una devolución anterior ya deshecha— y el caso de abajo lo caza.
  causa: "not_found",
  intentosEntrega: 3,
};

describe("236/R39 — columnas de descarga de la pestaña de ayuda", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla", () => {
    expect(COLUMNAS_DESCARGA_AYUDA.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "telefono",
      "direccion",
      "ubicacion",
      "producto",
      "montoCobrar",
      "intentosContacto",
      "intentos",
    ]);
    expect(COLUMNAS_DESCARGA_AYUDA.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Teléfono",
      "Dirección",
      "Ubicación",
      "Producto",
      "Monto a cobrar",
      "Intentos de contacto",
      "Intentos de entrega",
    ]);
  });

  it("R39/R26: NO existe la columna de causa, ni el texto que anuncia su ausencia", () => {
    // Las tres formas en que podría colarse: como clave, como encabezado, o como celda.
    expect(COLUMNAS_DESCARGA_AYUDA.map((c) => c.clave)).not.toContain("causa");
    for (const columna of COLUMNAS_DESCARGA_AYUDA) {
      expect(columna.encabezado, columna.clave).not.toMatch(/causa/i);
    }
    const fila = filaDescargaAyuda(EN_AYUDA);
    expect(Object.keys(fila)).not.toContain("causa");
    // Ni el placeholder que hoy sale en el archivo de devoluciones: R26 prohíbe también anunciar
    // la ausencia. `EN_AYUDA` lleva una causa REAL, así que si la fila la leyera saldría aquí.
    expect(Object.values(fila)).not.toContain(SIN_CAUSA_REGISTRADA);
    expect(Object.values(fila)).not.toContain("not_found");
    expect(Object.values(fila)).not.toContain("Cliente no localizado");
  });

  it("control positivo: el archivo de DEVOLUCIONES sí la tiene (los dos no son el mismo)", () => {
    // Sin este, el caso de arriba estaría verde también si el archivo de novedades hubiera
    // perdido la columna por otro motivo, o si los dos módulos fueran el mismo.
    expect(COLUMNAS_DESCARGA_NOVEDADES.map((c) => c.clave)).toContain("causa");
    expect(COLUMNAS_DESCARGA_AYUDA).not.toBe(COLUMNAS_DESCARGA_NOVEDADES);
  });

  it("la columna PROPIA de esta pestaña son los intentos de CONTACTO, y el otro archivo no la tiene", () => {
    expect(COLUMNAS_DESCARGA_AYUDA.map((c) => c.clave)).toContain("intentosContacto");
    expect(COLUMNAS_DESCARGA_NOVEDADES.map((c) => c.clave)).not.toContain("intentosContacto");
  });

  it("la fila trae EXACTAMENTE las claves declaradas, sin sobrantes ni ausentes", () => {
    expect(Object.keys(filaDescargaAyuda(EN_AYUDA)).sort()).toEqual(
      COLUMNAS_DESCARGA_AYUDA.map((c) => c.clave).sort(),
    );
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos", () => {
    for (const [clave, celda] of Object.entries(filaDescargaAyuda(EN_AYUDA))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("la guia nula deja la celda VACIA, no el placeholder de presentacion de la card", () => {
    const fila = filaDescargaAyuda({
      ...EN_AYUDA,
      numGuia: null,
      direccion: null,
      montoCobrar: null,
    });
    expect(fila.numGuia).toBeNull();
    expect(fila.direccion).toBeNull();
    expect(fila.montoCobrar).toBeNull();
    // Y no se disfraza de otra cosa: ni «Sin guía», ni cadena vacía, ni 0.
    expect(fila.numGuia).not.toBe("");
    expect(fila.numGuia).not.toBe(0);
  });

  it("el `0` de los DOS contadores SI viaja: es un dato, no un hueco", () => {
    const sinIntentos = filaDescargaAyuda({
      ...EN_AYUDA,
      intentosContacto: 0,
      intentosEntrega: 0,
    });
    expect(sinIntentos.intentosContacto).toBe(0);
    expect(sinIntentos.intentos).toBe(0);
    expect(sinIntentos.intentosContacto).not.toBeNull();
    expect(sinIntentos.intentos).not.toBeNull();

    // `intentosEntrega` es opcional en el contrato: sin el campo, la fila no puede romperse.
    const sinCampo: NovedadDTO = { ...EN_AYUDA };
    delete sinCampo.intentosEntrega;
    expect(filaDescargaAyuda(sinCampo).intentos).toBe(0);

    // Control positivo: con valores, viajan tal cual (si no, los ceros de arriba serían ciertos
    // por la razón equivocada — una fila que siempre devuelve 0).
    expect(filaDescargaAyuda(EN_AYUDA).intentosContacto).toBe(2);
    expect(filaDescargaAyuda(EN_AYUDA).intentos).toBe(3);
  });

  it("no publica lo que la pantalla no ensena: ni uuid, ni coordenadas, ni estatus, ni notas", () => {
    const valores = Object.values(filaDescargaAyuda(EN_AYUDA));
    expect(valores).not.toContain(EN_AYUDA.id);
    expect(valores).not.toContain(EN_AYUDA.latitud);
    expect(valores).not.toContain(EN_AYUDA.longitud);
    expect(valores).not.toContain(EN_AYUDA.estatusValue);
    // La tienda es SIEMPRE la del actor: una columna con el mismo valor en todas las filas.
    expect(valores).not.toContain(EN_AYUDA.tiendaNombre);
    // Y el texto libre de la orden tampoco: el hilo de notas NO se descarga (R47).
    expect(valores).not.toContain(EN_AYUDA.notas);
  });

  it("compone la ubicacion en una linea y tolera el distrito ausente", () => {
    expect(filaDescargaAyuda(EN_AYUDA).ubicacion).toBe(
      "GAM Oeste · San José · Escazú · San Rafael",
    );
    expect(filaDescargaAyuda({ ...EN_AYUDA, distritoNombre: null }).ubicacion).toBe(
      "GAM Oeste · San José · Escazú",
    );
  });

  it("D6: el archivo se llama como la pestaña, en español y sin jerga", () => {
    expect(TITULO_DESCARGA_AYUDA).toBe("Ayuda solicitada");
    // «gestionar» es el verbo del MENSAJERO en este repo; en la pantalla de la tienda diría otra
    // cosa. Firmado por el humano el 2026-08-19 (D6), apartándose del §F2 del diseño de la pila.
    expect(TITULO_DESCARGA_AYUDA).not.toMatch(/gestionar/i);
  });
});
