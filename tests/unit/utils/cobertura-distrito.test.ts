import { describe, it, expect } from "vitest";

import { clasificarCobertura, compararCobertura } from "@/lib/utils/cobertura-distrito";

import type { MotivoSinCobertura } from "@/lib/types/cobertura";

import { fila, type OpcionesFila } from "./_cobertura-fixtures";

// Ficha 465 (T2) — la regla pura del Excel de cobertura: R6, R7, R8, R9, R11 (zonas), R12-R14
// (los hechos; los textos los fija el test del cliente).

const SIN_TARIFAS: ReadonlySet<string> = new Set();

describe("465/R7-R8 — disponible y cobertura", () => {
  it("disponible + zona unica -> cobertura, sin motivo (R8, R10)", () => {
    const dto = clasificarCobertura(fila(), SIN_TARIFAS);
    expect(dto.disponible).toBe(true);
    expect(dto.cobertura).toBe(true);
    expect(dto.motivo).toBeNull();
  });

  it("distrito activo bajo canton retirado: NO disponible (R7) y sin cobertura (R8)", () => {
    const dto = clasificarCobertura(fila({ cantonActivo: false }), SIN_TARIFAS);
    expect(dto.disponible).toBe(false);
    expect(dto.cobertura).toBe(false);
    expect(dto.motivo).toBe("canton_retirado");
  });

  it("disponible pero sin zona o con varias: sin cobertura (R8)", () => {
    expect(clasificarCobertura(fila({ zonas: [] }), SIN_TARIFAS).cobertura).toBe(false);
    expect(
      clasificarCobertura(
        fila({ zonas: [{ id: "a", nombre: "A" }, { id: "b", nombre: "B" }] }),
        SIN_TARIFAS,
      ).cobertura,
    ).toBe(false);
  });
});

describe("465/R9 — el PRIMER motivo que aplique", () => {
  const casos: [OpcionesFila, MotivoSinCobertura][] = [
    [{ provinciaActiva: false, cantonActivo: false, distritoActivo: false, zonas: [] }, "provincia_retirada"],
    [{ cantonActivo: false, distritoActivo: false, zonas: [] }, "canton_retirado"],
    // Retirado con 0 zonas -> «distrito retirado», no «sin zona» (misma precedencia que resolveGeo).
    [{ distritoActivo: false, zonas: [] }, "distrito_retirado"],
    [{ zonas: [] }, "sin_zona"],
    [{ zonas: [{ id: "a", nombre: "A" }, { id: "b", nombre: "B" }] }, "varias_zonas"],
    // Provincia retirada con zona unica: el motivo sigue siendo la provincia.
    [{ provinciaActiva: false }, "provincia_retirada"],
  ];

  it.each(casos)("%o -> %s", (opciones, motivo) => {
    const dto = clasificarCobertura(fila(opciones), SIN_TARIFAS);
    expect(dto.cobertura).toBe(false);
    expect(dto.motivo).toBe(motivo);
  });
});

describe("465/R11, R12, R14 — zonas, GAM y tarifa general", () => {
  it("varias zonas: nombres en orden alfabetico español y SIN zona unica", () => {
    const dto = clasificarCobertura(
      fila({
        zonas: [
          { id: "1", nombre: "Zarcero" },
          { id: "2", nombre: "Ángeles" },
          { id: "3", nombre: "bodega" },
        ],
      }),
      new Set(["1", "2", "3"]),
    );
    expect(dto.zonas).toEqual(["Ángeles", "bodega", "Zarcero"]);
    expect(dto.zonaUnica).toBeNull();
  });

  it("sin zona: lista vacia y sin zona unica", () => {
    const dto = clasificarCobertura(fila({ zonas: [] }), SIN_TARIFAS);
    expect(dto.zonas).toEqual([]);
    expect(dto.zonaUnica).toBeNull();
  });

  it("zona unica central con tarifa general", () => {
    const dto = clasificarCobertura(
      fila({ zonas: [{ id: "z1", nombre: "GAM", esCentral: true }] }),
      new Set(["z1"]),
    );
    expect(dto.zonaUnica).toEqual({ nombre: "GAM", esCentral: true, tieneTarifaGeneral: true });
  });

  it("zona unica no central sin tarifa general (la tarifa de OTRA zona no cuenta)", () => {
    const dto = clasificarCobertura(
      fila({ zonas: [{ id: "z2", nombre: "Guanacaste", esCentral: false }] }),
      new Set(["z1"]),
    );
    expect(dto.zonaUnica).toEqual({
      nombre: "Guanacaste",
      esCentral: false,
      tieneTarifaGeneral: false,
    });
  });

  it("distrito NO disponible con zona unica: se informa la zona igual (R11)", () => {
    const dto = clasificarCobertura(
      fila({ distritoActivo: false, zonas: [{ id: "z2", nombre: "Guanacaste" }] }),
      new Set(["z2"]),
    );
    expect(dto.cobertura).toBe(false);
    expect(dto.zonas).toEqual(["Guanacaste"]);
    expect(dto.zonaUnica?.tieneTarifaGeneral).toBe(true);
  });
});

describe("465/R13 — zona especial tri-valuada", () => {
  it.each([true, false, null])("zonaEspecial %s se conserva tal cual", (valor) => {
    expect(clasificarCobertura(fila({ zonaEspecial: valor }), SIN_TARIFAS).zonaEspecial).toBe(valor);
  });
});

describe("465/R6 — orden provincia, canton, distrito sin mayusculas ni tildes", () => {
  it("ordena por los tres niveles", () => {
    const filas = [
      fila({ provincia: "San José", canton: "Escazú", distrito: "San Rafael" }),
      fila({ provincia: "Alajuela", canton: "Grecia", distrito: "Tacares" }),
      fila({ provincia: "san jose", canton: "Acosta", distrito: "Palmichal" }),
      fila({ provincia: "Alajuela", canton: "Atenas", distrito: "Jesús" }),
      fila({ provincia: "Alajuela", canton: "Atenas", distrito: "concepción" }),
      fila({ provincia: "Alajuela", canton: "Atenas", distrito: "Escobal" }),
    ].map((r) => clasificarCobertura(r, SIN_TARIFAS));

    const orden = [...filas].sort(compararCobertura).map((d) => `${d.provincia}/${d.canton}/${d.distrito}`);
    expect(orden).toEqual([
      "Alajuela/Atenas/concepción",
      "Alajuela/Atenas/Escobal",
      "Alajuela/Atenas/Jesús",
      "Alajuela/Grecia/Tacares",
      "san jose/Acosta/Palmichal",
      "San José/Escazú/San Rafael",
    ]);
  });

  it("tildes y mayusculas no distinguen: «Ángeles» y «angeles» comparan igual", () => {
    const a = clasificarCobertura(fila({ provincia: "P", canton: "C", distrito: "Ángeles" }), SIN_TARIFAS);
    const b = clasificarCobertura(fila({ provincia: "p", canton: "c", distrito: "angeles" }), SIN_TARIFAS);
    expect(compararCobertura(a, b)).toBe(0);
  });
});
