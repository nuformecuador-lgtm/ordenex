import { describe, it, expect } from "vitest";

import { diasNaturalesCRDesde } from "@/lib/utils/fecha-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T10 (R21) — LA ANTIGUEDAD DE LA CONSOLIDACION MAS VIEJA SIN CONCILIAR.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE SE PRUEBA, Y POR QUE NO ES OBVIO: se cuentan DIAS DE CALENDARIO de Costa Rica, no
// periodos de 24 horas. Las dos cuentas dan numeros distintos justo en el borde del dia, que es
// donde la pantalla se lee peor: una consolidacion creada ayer a las 23:50 y mirada hoy a las 00:10
// lleva **1 dia**, no 0. Eso es lo que contesta una persona cuando le preguntan «¿de cuando es?».
//
// El dia de Costa Rica empieza a las 06:00 UTC (UTC-6, sin horario de verano). Todos los instantes
// de abajo estan escritos en UTC A PROPOSITO, con su hora de pared de CR al lado: es la unica forma
// de que el caso diga lo que mide.

describe("431/R21 — `diasNaturalesCRDesde` cuenta dias de CALENDARIO, no de 24 horas", () => {
  it("el mismo dia de calendario -> 0, aunque hayan pasado horas", () => {
    const desde = new Date("2026-09-16T13:00:00.000Z"); // 07:00 CR del 16
    const ahora = new Date("2026-09-16T23:00:00.000Z"); // 17:00 CR del 16
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(0);
  });

  it("⭑ 20 MINUTOS a caballo del cambio de dia CR -> 1, no 0", () => {
    // 05:50 UTC es 23:50 CR del dia 15; 06:10 UTC es 00:10 CR del 16. Han pasado 20 minutos y UN
    // dia de calendario. Una cuenta de 24 horas diria 0 y la pantalla mentiria por un dia entero.
    const desde = new Date("2026-09-16T05:50:00.000Z");
    const ahora = new Date("2026-09-16T06:10:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(1);
  });

  it("⭑ 23 horas y 50 minutos DENTRO del mismo dia CR -> 0, no 1", () => {
    // El espejo del caso anterior: 06:10 UTC (00:10 CR) a 05:59 UTC del dia siguiente (23:59 CR del
    // MISMO dia). Casi 24 horas, cero dias de calendario.
    const desde = new Date("2026-09-16T06:10:00.000Z");
    const ahora = new Date("2026-09-17T05:59:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(0);
  });

  it("cinco dias justos -> 5", () => {
    const desde = new Date("2026-09-11T12:00:00.000Z");
    const ahora = new Date("2026-09-16T12:00:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(5);
  });

  it("cruza el fin de mes sin perder la cuenta", () => {
    const desde = new Date("2026-08-30T12:00:00.000Z");
    const ahora = new Date("2026-09-02T12:00:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(3);
  });

  it("un instante FUTURO devuelve 0, no un negativo que la pantalla no sabria leer", () => {
    const desde = new Date("2026-09-20T12:00:00.000Z");
    const ahora = new Date("2026-09-16T12:00:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(0);
  });

  it("no depende del huso de quien pregunta: dos instantes iguales dan lo mismo", () => {
    // La misma pregunta escrita de dos formas. Si la funcion usara la hora LOCAL del proceso, el
    // resultado cambiaria segun la maquina que corriera el test.
    const desde = new Date(Date.UTC(2026, 8, 11, 18, 0, 0));
    const ahora = new Date("2026-09-16T18:00:00.000Z");
    expect(diasNaturalesCRDesde(desde, ahora)).toBe(5);
  });
});
