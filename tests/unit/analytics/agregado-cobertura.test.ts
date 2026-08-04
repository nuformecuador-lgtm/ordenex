import { describe, it, expect } from "vitest";
import { HORIZONTE_HISTORIAL_CR } from "@/lib/analytics/backfill-rango";
import { PENUMBRA } from "@/lib/types/analitica-operativa";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.5 (primera mitad) — R9.
//
// El agregado hereda el compromiso de la 126: la respuesta declara lo que sabe sobre su
// propia cobertura. Y aqui pesa MAS que en la serie, no menos: al fundir los dias en un solo
// numero, los dias que caen bajo el horizonte del historial dejan de ser visibles como
// huecos del eje. Agregar sobre dias sin dato y no decirlo es la misma mentira de siempre,
// solo que sumada.
//
// Por eso `cobertura` se declara SIN `?` en `AgregadoOperativo`: opcional permitiria a un
// consumidor ignorarla por omision, y entonces «cero» y «no se sabe» volverian a ser el
// mismo pixel.

const RANGO_QUE_CRUZA_EL_HORIZONTE = {
  rango: "personalizado",
  desde: "2026-07-10",
  hasta: "2026-07-14",
} as const;

describe("R9 · la respuesta agregada declara su cobertura", () => {
  it("la respuesta agregada declara cobertura con las fechas no comparables del rango", async () => {
    const cubos = [cubo({ fecha: "2026-07-14", entregas: 4, devoluciones: 1 })];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", undefined, RANGO_QUE_CRUZA_EL_HORIZONTE),
    );

    expect(
      Object.prototype.hasOwnProperty.call(agregado, "cobertura"),
      "el agregado no emite `cobertura`",
    ).toBe(true);
    expect(agregado.cobertura.fechasNoComparables).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    // Todas por debajo del horizonte, y ninguna igual o posterior.
    for (const f of agregado.cobertura.fechasNoComparables) {
      expect(f < HORIZONTE_HISTORIAL_CR).toBe(true);
    }
    // R20 — la penumbra se DECLARA, no se estima. Misma constante que la 126.
    expect(agregado.cobertura.penumbra).toBe(PENUMBRA);
  });

  it("y es la MISMA cobertura que devuelve la serie para la misma consulta", async () => {
    const cubos = [cubo({ fecha: "2026-07-14", entregas: 4, devoluciones: 1 })];
    const servicio = servicioCon(rollupFalso(cubos));
    const consulta = consultaDe("tasa_entrega", undefined, RANGO_QUE_CRUZA_EL_HORIZONTE);

    const serie = await servicio.consultar(consulta);
    const agregado = await servicio.consultarAgregado(consulta);

    expect(agregado.cobertura).toEqual(serie.cobertura);
  });

  it("un rango limpio declara la cobertura igualmente, con la lista vacia", async () => {
    // Emitirla solo cuando hay hallazgos obligaria al consumidor a distinguir «no hay
    // problema» de «no me lo dijeron».
    const agregado = await servicioCon(
      rollupFalso([cubo({ fecha: "2026-08-01", entregas: 2 })]),
    ).consultarAgregado(
      consultaDe("tasa_entrega", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
    );
    expect(agregado.cobertura.fechasNoComparables).toEqual([]);
    expect(agregado.cobertura.penumbra).toBe(PENUMBRA);
  });
});
