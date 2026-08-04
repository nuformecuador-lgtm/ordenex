import { describe, it, expect } from "vitest";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T4.4 — R12. `ordenes_estado_stock` es un STOCK al corte del dia.
//
// Sumarla entre fechas cuenta la MISMA orden una vez por cada dia que estuvo viva: un numero
// mayor, plausible y falso, que nadie detecta mirandolo. La prohibicion vale TAMBIEN para los
// tres estatus terminales, donde D2-B2 de la 124 la vuelve *de hecho* un flujo del dia: esa
// coincidencia no se explota (`design.md > D5`).
//
// Este archivo es la mitad funcional de R12; la otra mitad es el tripwire ya existente de R43
// de la 124 (`tests/integration/db/analytics-daily-guards.test.ts`), que vigila el TEXTO.

const ETIQUETAS = new Map([
  ["e-reparto", { value: "en_reparto", label: "en_reparto" }],
  ["e-entregada", { value: "entregada", label: "entregada" }],
]);

/** Tres dias con 10 ordenes vivas en el mismo estado: es la MISMA decena, no 30 ordenes. */
const TRES_DIAS = [
  cubo({ fecha: "2026-08-01", estatusId: "e-reparto", ordenesEstadoStock: 10 }),
  cubo({ fecha: "2026-08-02", estatusId: "e-reparto", ordenesEstadoStock: 10 }),
  cubo({ fecha: "2026-08-03", estatusId: "e-reparto", ordenesEstadoStock: 10 }),
];

describe("R12 · el embudo es una serie por fecha, nunca un total del rango", () => {
  it("el embudo de un rango de tres dias devuelve tres puntos, no uno sumado", async () => {
    const serie = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-03",
      }),
    );
    expect(serie.puntos).toHaveLength(3);
    expect(serie.puntos.map((p) => p.fecha)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    // Cada punto vale 10. Ningun punto vale 30: eso seria el `SUM` del rango que R12 prohibe.
    expect(serie.puntos.map((p) => p.valor)).toEqual([10, 10, 10]);
    expect(serie.puntos.map((p) => p.valor)).not.toContain(30);
  });

  it("y la fecha viaja en CADA punto: sin ella no habria como no sumarlos", async () => {
    const serie = await servicioCon(rollupFalso(TRES_DIAS, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-03",
      }),
    );
    for (const punto of serie.puntos) expect(punto.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dentro de UNA fecha si se agregan los cubos: eso no es sumar entre fechas", async () => {
    // El recorte de un dia tiene varios cubos (zona x tienda x mensajero x estatus) y sumarlos
    // es correcto: cada orden aporta 1 a UN solo cubo de esa fecha. R12 prohibe cruzar fechas,
    // no agregar dentro de una.
    const unDia = [
      cubo({ fecha: "2026-08-01", zonaId: "z1", estatusId: "e-reparto", ordenesEstadoStock: 4 }),
      cubo({ fecha: "2026-08-01", zonaId: "z2", estatusId: "e-reparto", ordenesEstadoStock: 6 }),
    ];
    const serie = await servicioCon(rollupFalso(unDia, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado"),
    );
    expect(serie.puntos).toHaveLength(1);
    expect(serie.puntos[0].valor).toBe(10);
  });

  it("los estatus TERMINALES tampoco se suman entre fechas (D2-B2 no se explota)", async () => {
    const terminales = [
      cubo({ fecha: "2026-08-01", estatusId: "e-entregada", ordenesEstadoStock: 5 }),
      cubo({ fecha: "2026-08-02", estatusId: "e-entregada", ordenesEstadoStock: 7 }),
    ];
    const serie = await servicioCon(rollupFalso(terminales, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
    );
    expect(serie.puntos.map((p) => p.valor)).toEqual([5, 7]);
    expect(serie.puntos.map((p) => p.valor)).not.toContain(12);
  });

  it("y desagrega por estatus con la etiqueta de la tabla, un punto por (fecha, estatus)", async () => {
    const mezcla = [
      cubo({ fecha: "2026-08-01", estatusId: "e-reparto", ordenesEstadoStock: 3 }),
      cubo({ fecha: "2026-08-01", estatusId: "e-entregada", ordenesEstadoStock: 2 }),
    ];
    const serie = await servicioCon(rollupFalso(mezcla, ETIQUETAS)).consultar(
      consultaDe("ordenes_por_estado"),
    );
    expect(serie.puntos).toHaveLength(2);
    expect(serie.puntos.map((p) => p.dimension).sort()).toEqual(["en_reparto", "entregada"]);
  });
});
