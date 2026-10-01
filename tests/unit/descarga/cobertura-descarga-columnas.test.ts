// Ficha 465 (T7) — columnas y proyección del Excel de cobertura por distrito. Cubre R5 y los
// TEXTOS de R7-R14. Los literales SON el contrato: no se comparan contra la propia fuente.
import { describe, it, expect } from "vitest";

import {
  AMBITO_DESCARGA_COBERTURA,
  COLUMNAS_DESCARGA_COBERTURA,
  filaCobertura,
} from "@/app/(app)/configuracion/tarifas/_components/cobertura-descarga-columnas";
import type { CoberturaDistritoDTO } from "@/lib/types/cobertura";

function dto(parcial: Partial<CoberturaDistritoDTO> = {}): CoberturaDistritoDTO {
  return {
    provincia: "San José",
    canton: "Escazú",
    distrito: "San Rafael",
    disponible: true,
    cobertura: true,
    motivo: null,
    zonas: ["Central"],
    zonaUnica: { nombre: "Central", esCentral: true, tieneTarifaGeneral: true },
    zonaEspecial: false,
    ...parcial,
  };
}

describe("465/R5 — columnas del archivo, en su orden por defecto", () => {
  it("orden de las claves (contrato del archivo)", () => {
    expect(COLUMNAS_DESCARGA_COBERTURA.map((c) => c.clave)).toEqual([
      "provincia",
      "canton",
      "distrito",
      "activo",
      "cobertura",
      "motivo",
      "zona",
      "gam",
      "zona_especial",
      "tarifa_general",
    ]);
  });

  it("claves y encabezados exactos, en el orden de R5", () => {
    expect(COLUMNAS_DESCARGA_COBERTURA).toEqual([
      { clave: "provincia", encabezado: "Provincia" },
      { clave: "canton", encabezado: "Cantón" },
      { clave: "distrito", encabezado: "Distrito" },
      { clave: "activo", encabezado: "Activo" },
      { clave: "cobertura", encabezado: "Cobertura" },
      { clave: "motivo", encabezado: "Motivo sin cobertura" },
      { clave: "zona", encabezado: "Zona" },
      { clave: "gam", encabezado: "GAM" },
      { clave: "zona_especial", encabezado: "Zona especial" },
      { clave: "tarifa_general", encabezado: "Tarifa general de la zona" },
    ]);
  });

  it("R16 — ámbito propio de preferencia de columnas, con forma de etiqueta", () => {
    expect(AMBITO_DESCARGA_COBERTURA).toBe("tarifas-cobertura");
  });

  it("cada fila aporta exactamente las claves declaradas", () => {
    expect(Object.keys(filaCobertura(dto()))).toEqual([
      "provincia",
      "canton",
      "distrito",
      "activo",
      "cobertura",
      "motivo",
      "zona",
      "gam",
      "zona_especial",
      "tarifa_general",
    ]);
  });
});

describe("465/R7-R14 — textos de cada celda", () => {
  it("distrito con cobertura: Sí/Sí, motivo vacío (R10), zona por nombre, GAM y tarifa", () => {
    expect(filaCobertura(dto())).toEqual({
      provincia: "San José",
      canton: "Escazú",
      distrito: "San Rafael",
      activo: "Sí",
      cobertura: "Sí",
      motivo: null,
      zona: "Central",
      gam: "Sí",
      zona_especial: "No",
      tarifa_general: "Sí",
    });
  });

  it("R12/R14 — zona única no central y sin tarifa general: «No» y «No»", () => {
    const fila = filaCobertura(
      dto({
        zonas: ["Norte"],
        zonaUnica: { nombre: "Norte", esCentral: false, tieneTarifaGeneral: false },
      }),
    );
    expect(fila.gam).toBe("No");
    expect(fila.tarifa_general).toBe("No");
    expect(fila.zona).toBe("Norte");
  });

  // B1 de la revisión: con los dos datos iguales, cruzar qué dato alimenta cada columna pasa
  // en verde. Estos dos casos los ponen DISTINTOS en ambos sentidos.
  it("R12/R14 — zona central SIN tarifa general: GAM «Sí», tarifa general «No»", () => {
    const fila = filaCobertura(
      dto({ zonaUnica: { nombre: "Central", esCentral: true, tieneTarifaGeneral: false } }),
    );
    expect(fila.gam).toBe("Sí");
    expect(fila.tarifa_general).toBe("No");
  });

  it("R12/R14 — zona NO central CON tarifa general: GAM «No», tarifa general «Sí»", () => {
    const fila = filaCobertura(
      dto({
        zonas: ["Norte"],
        zonaUnica: { nombre: "Norte", esCentral: false, tieneTarifaGeneral: true },
      }),
    );
    expect(fila.gam).toBe("No");
    expect(fila.tarifa_general).toBe("Sí");
  });

  it.each([
    ["provincia_retirada", "Provincia retirada del catálogo"],
    ["canton_retirado", "Cantón retirado del catálogo"],
    ["distrito_retirado", "Distrito retirado del catálogo"],
    ["sin_zona", "Sin zona asignada"],
    ["varias_zonas", "Asignado a varias zonas"],
  ] as const)("R9 — motivo %s → «%s»", (motivo, texto) => {
    const fila = filaCobertura(dto({ cobertura: false, motivo }));
    expect(fila.cobertura).toBe("No");
    expect(fila.motivo).toBe(texto);
  });

  it("R11/R12/R14 — sin zona: «Sin zona», GAM y tarifa general VACÍAS", () => {
    const fila = filaCobertura(
      dto({ cobertura: false, motivo: "sin_zona", zonas: [], zonaUnica: null }),
    );
    expect(fila.zona).toBe("Sin zona");
    expect(fila.gam).toBeNull();
    expect(fila.tarifa_general).toBeNull();
  });

  it("R11 — varias zonas: «Varias zonas: A, B», GAM y tarifa general vacías", () => {
    const fila = filaCobertura(
      dto({
        cobertura: false,
        motivo: "varias_zonas",
        zonas: ["Alajuela Este", "Central"],
        zonaUnica: null,
      }),
    );
    expect(fila.zona).toBe("Varias zonas: Alajuela Este, Central");
    expect(fila.gam).toBeNull();
    expect(fila.tarifa_general).toBeNull();
  });

  it("R7/R11 — distrito NO disponible con zona única: Activo «No» y la zona igual se nombra", () => {
    const fila = filaCobertura(
      dto({ disponible: false, cobertura: false, motivo: "canton_retirado" }),
    );
    expect(fila.activo).toBe("No");
    expect(fila.cobertura).toBe("No");
    expect(fila.motivo).toBe("Cantón retirado del catálogo");
    expect(fila.zona).toBe("Central");
  });

  it.each([
    [true, "Sí"],
    [false, "No"],
    [null, "Sin definir"],
  ] as const)("R13 — zona especial %s → «%s»", (valor, texto) => {
    expect(filaCobertura(dto({ zonaEspecial: valor })).zona_especial).toBe(texto);
  });
});
