import { describe, it, expect } from "vitest";

import {
  PERIODICIDAD_OPTIONS,
  PERIODICIDAD_PRESETS,
  PROXIMO_COBRO_INACTIVA,
  periodicidadLegible,
  presetDePeriodicidad,
  proximoCobroTexto,
} from "@/app/(app)/wallet/_components/wallet-labels";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";

// Feature 85 (T F.1, R19/R20) — el VOCABULARIO de la periodicidad del gasto fijo.
//
// Todo lo que se asevera aquí va como LITERAL, nunca derivado de `PERIODICIDAD_PRESETS`: un
// `expect(periodicidadLegible(p.unidad, p.cantidad)).toBe(p.label)` recorriendo la tabla está
// verde por construcción —compara la función contra su propia fuente— y en este repo esa
// familia de aserción ya dejó pasar un fallo real. Los nombres los fijó el pedido; si alguien
// los cambia, este archivo tiene que enterarse.
//
// Módulo PURO: sin jsdom (`@vitest-environment` por defecto = node). Si un día necesitara el
// DOM, es que dejó de ser el módulo de etiquetas.

/** Plantilla base. El ciclo de cada caso lo pisa el propio caso. */
const PLANTILLA: GastoFijoPlantillaDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  concepto: "Alquiler de bodega",
  monto: "300.00",
  activa: true,
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-08-31",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("periodicidadLegible — cada cuánto se cobra, en palabras (R20)", () => {
  it("nombra las cuatro del pedido: Diaria, Semanal, Quincenal y Mensual", () => {
    expect(periodicidadLegible("dias", 1)).toBe("Diaria");
    expect(periodicidadLegible("semanas", 1)).toBe("Semanal");
    expect(periodicidadLegible("semanas", 2)).toBe("Quincenal");
    expect(periodicidadLegible("meses", 1)).toBe("Mensual");
  });

  it("compone «Cada N …» para cualquier otro ciclo, con la unidad en plural", () => {
    expect(periodicidadLegible("dias", 3)).toBe("Cada 3 días");
    expect(periodicidadLegible("meses", 6)).toBe("Cada 6 meses");
    expect(periodicidadLegible("semanas", 3)).toBe("Cada 3 semanas");
  });

  it("una unidad que no es ninguna de las tres se dice tal cual, sin reventar", () => {
    // Rama defensiva del `??`. No es hipotética: la guardia de datos sensibles de las
    // descargas ejecuta esta función con una sonda (un Proxy), y sin el `??` la generación
    // del archivo se caía con «Cannot read properties of undefined». Se afirma aquí para que
    // nadie retire el fallback por «código muerto» sin leer esto.
    const unidadDesconocida = "trimestres" as unknown as PeriodicidadUnidad;
    expect(periodicidadLegible(unidadDesconocida, 2)).toBe("Cada 2 trimestres");
  });

  it("los cuatro nombres del pedido siguen declarados, y son exactamente cuatro", () => {
    // Censo: dice CUÁLES son y CUÁNTOS, para que añadir un quinto nombre sea una decisión y
    // no un descuido. El pedido nombró cuatro, y son los que el selector ofrece.
    expect(PERIODICIDAD_PRESETS.map((p) => p.label)).toEqual([
      "Diaria",
      "Semanal",
      "Quincenal",
      "Mensual",
    ]);
  });

  it("el selector ofrece los cuatro presets y «Personalizada», en ese orden", () => {
    expect(PERIODICIDAD_OPTIONS.map((o) => o.value)).toEqual([
      "diaria",
      "semanal",
      "quincenal",
      "mensual",
      "personalizada",
    ]);
    expect(PERIODICIDAD_OPTIONS.map((o) => o.label)).toEqual([
      "Diaria",
      "Semanal",
      "Quincenal",
      "Mensual",
      "Personalizada",
    ]);
  });
});

describe("presetDePeriodicidad — qué opción representa un ciclo guardado", () => {
  it("reconoce las cuatro del pedido por su par unidad+cantidad", () => {
    expect(presetDePeriodicidad("dias", 1)).toBe("diaria");
    expect(presetDePeriodicidad("semanas", 1)).toBe("semanal");
    expect(presetDePeriodicidad("semanas", 2)).toBe("quincenal");
    expect(presetDePeriodicidad("meses", 1)).toBe("mensual");
  });

  it("un ciclo propio cae en «personalizada»", () => {
    expect(presetDePeriodicidad("dias", 3)).toBe("personalizada");
    expect(presetDePeriodicidad("meses", 6)).toBe("personalizada");
  });
});

describe("proximoCobroTexto — la celda de «Próximo cobro» (R18/R19)", () => {
  it("pone la fecha en palabras CON AÑO, a partir del instante recibido", () => {
    // Quincenal anclada el 31/08/2026; el instante es el 01/09/2026 a las 12:00 CR.
    // El siguiente disparo cae 14 días después del ancla: el 14 de septiembre.
    const texto = proximoCobroTexto(PLANTILLA, new Date("2026-09-01T18:00:00.000Z"));
    expect(texto).toBe("14 de septiembre de 2026");
  });

  it("una plantilla inactiva dice que no se cobra, en vez de una fecha", () => {
    const texto = proximoCobroTexto(
      { ...PLANTILLA, activa: false },
      new Date("2026-09-01T18:00:00.000Z"),
    );
    expect(texto).toBe("No se cobra");
    expect(PROXIMO_COBRO_INACTIVA).toBe("No se cobra");
    // Y no se cuela ninguna fecha en el texto.
    expect(texto).not.toMatch(/\d/);
  });

  it("no lee el reloj del proceso: dos instantes distintos dan dos respuestas distintas", () => {
    const enSeptiembre = proximoCobroTexto(PLANTILLA, new Date("2026-09-01T18:00:00.000Z"));
    const enOctubre = proximoCobroTexto(PLANTILLA, new Date("2026-10-01T18:00:00.000Z"));
    expect(enSeptiembre).toBe("14 de septiembre de 2026");
    expect(enOctubre).toBe("12 de octubre de 2026");
  });

  it("un ciclo largo cruza el año, y por eso el año va SIEMPRE", () => {
    const texto = proximoCobroTexto(
      { ...PLANTILLA, periodicidadUnidad: "meses", periodicidadCantidad: 6 },
      new Date("2026-09-01T18:00:00.000Z"),
    );
    // Ancla 31/08/2026 + 6 meses, con el clamping de fin de mes de febrero: 28/02/2027.
    expect(texto).toBe("28 de febrero de 2027");
  });
});
