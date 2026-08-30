import { describe, it, expect } from "vitest";

import {
  CONCEPTOS_MANUALES,
  CONCEPTO_MANUAL_IDS,
  CONCEPTO_MANUAL_OPTIONS,
  conceptoPorId,
  nombreEnElLibro,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import { CATEGORIA_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Ficha 334 (T D2, design §9) — el catálogo de conceptos registrables A MANO es la única
// fuente del selector unificado, así que es el sitio donde se puede AFIRMAR la regla que la
// fusión no puede perder: el gasto FIJO no se registra a mano (R11, heredada del R19 de la 45).

const CATEGORIAS_ESPERADAS = [
  "egreso_gasto_variable",
  "egreso_sueldo",
  "ingreso_ajuste",
  "egreso_ajuste",
] as const;

describe("catálogo de conceptos manuales — son exactamente CUATRO (R3)", () => {
  it("el catálogo ofrece los cuatro conceptos del pedido y ninguno más", () => {
    expect(CONCEPTOS_MANUALES).toHaveLength(4);
    expect(CONCEPTOS_MANUALES.map((c) => c.id)).toEqual([
      "gasto_variable",
      "sueldo",
      "ajuste_ingreso",
      "ajuste_egreso",
    ]);
    // Las opciones del `Select` salen del catálogo, no de una segunda lista escrita a mano.
    expect(CONCEPTO_MANUAL_OPTIONS.map((o) => o.value)).toEqual([...CONCEPTO_MANUAL_IDS]);
  });
});

describe("catálogo de conceptos manuales — ningún concepto lleva al gasto FIJO (R11)", () => {
  it("el conjunto de categorías destino es EXACTAMENTE las cuatro admitidas", () => {
    const destino = CONCEPTOS_MANUALES.map((c) => c.categoria).sort();
    expect(destino).toEqual([...CATEGORIAS_ESPERADAS].sort());
  });

  it("ninguno mapea a `egreso_gasto_fijo` ni a ninguna otra categoría del SEED", () => {
    const destino = new Set<string>(CONCEPTOS_MANUALES.map((c) => c.categoria));
    expect(destino.has("egreso_gasto_fijo")).toBe(false);

    // Y no solo el gasto fijo: se barre el SEED ENTERO, así que un concepto nuevo que abriera
    // `egreso_pago_tienda` o `ingreso_flete` a mano —cinco escrituras que hoy son automáticas—
    // cae aquí igual que caería el gasto fijo.
    const prohibidas = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => !CATEGORIAS_ESPERADAS.includes(c as (typeof CATEGORIAS_ESPERADAS)[number]),
    );
    expect(prohibidas.length, "el SEED se quedó sin categorías: no se estaría midiendo nada").
      toBeGreaterThan(4);
    for (const categoria of prohibidas) {
      expect(destino.has(categoria), `el concepto abre \`${categoria}\` a mano`).toBe(false);
    }
  });

  it("los dos ajustes van por `manual` y los dos gastos por `gasto` (design §6)", () => {
    // De este campo cuelga qué es reversable (`esEgresoAdministrativo`): el enrutado no puede
    // colapsar en una sola action sin cambiar, en silencio, qué movimientos se pueden deshacer.
    expect(conceptoPorId("gasto_variable")?.destino).toEqual({
      clase: "egreso_administrativo",
      tipoEgreso: "gasto_variable",
    });
    expect(conceptoPorId("sueldo")?.destino).toEqual({
      clase: "egreso_administrativo",
      tipoEgreso: "sueldo",
    });
    expect(conceptoPorId("ajuste_ingreso")?.destino).toEqual({
      clase: "ajuste_manual",
      tipo: "ingreso",
    });
    expect(conceptoPorId("ajuste_egreso")?.destino).toEqual({
      clase: "ajuste_manual",
      tipo: "egreso",
    });
  });
});

describe("catálogo de conceptos manuales — cada concepto trae su etiqueta de descripción (R9)", () => {
  it("los cuatro tienen etiqueta, etiqueta de descripción y ejemplo no vacíos", () => {
    for (const concepto of CONCEPTOS_MANUALES) {
      expect(concepto.label.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionLabel.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionPlaceholder.trim().length, concepto.id).toBeGreaterThan(0);
    }
  });

  it("las DOS etiquetas que ya existían se conservan byte a byte", () => {
    expect(conceptoPorId("gasto_variable")?.descripcionLabel).toBe("Concepto del gasto");
    expect(conceptoPorId("sueldo")?.descripcionLabel).toBe("Trabajador y periodo");
    // Los dos ajustes estrenan la suya, y es la MISMA para los dos: lo que se pide es el motivo.
    expect(conceptoPorId("ajuste_ingreso")?.descripcionLabel).toBe("Motivo del ajuste");
    expect(conceptoPorId("ajuste_egreso")?.descripcionLabel).toBe("Motivo del ajuste");
  });
});

describe("catálogo de conceptos manuales — el nombre del libro se DERIVA (R4)", () => {
  it("cada concepto dice el nombre con que su categoría sale en el libro", () => {
    for (const concepto of CONCEPTOS_MANUALES) {
      expect(nombreEnElLibro(concepto)).toBe(CATEGORIA_LABEL[concepto.categoria]);
      expect(nombreEnElLibro(concepto).trim().length, concepto.id).toBeGreaterThan(0);
    }
    // Control de no-vacuidad: la derivación entrega los nombres REALES del libro, no cadenas
    // vacías que casarían con cualquier cosa.
    expect(nombreEnElLibro(CONCEPTOS_MANUALES[0])).toBe("Gasto variable");
    expect(nombreEnElLibro(CONCEPTOS_MANUALES[2])).toBe("Ajuste (ingreso)");
  });
});
