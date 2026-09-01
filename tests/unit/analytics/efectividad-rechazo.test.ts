// FICHA 345 (T6.2) — los DOS campos que `calcularEfectividad` gana: `rechazadas` y `tasaRechazo`.
//
// Cubre R29 (el denominador incluye las órdenes en proceso) y R30 (entregadas, rechazadas, en
// proceso y el porcentaje de rechazo).
//
// LOS CASOS SON LOS MEDIDOS EN PRODUCCIÓN, no cifras redondas inventadas: `Spray Protector` con
// 37,5 % de rechazo sobre 16 órdenes y `Bálsamo Tensor` con 0 % sobre 29. El segundo es el que
// justifica que el tipo sea `number | null` y no `number`: **0 no es null**, y confundirlos
// borraría la diferencia entre «29 órdenes y ni un rechazo» y «no hubo órdenes».
//
// Módulo PURO: no monta nada. La aritmética es lo único que aquí puede equivocarse.
import { describe, it, expect } from "vitest";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { DESENLACES } from "@/lib/types/conteo-entregas";

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

describe("FICHA 345 · calcularEfectividad expone el rechazo (R30)", () => {
  it("reparte entregadas, rechazadas y en proceso sobre el mismo universo", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 8 },
      { status: "rechazada", conteo: 6 },
      { status: EN_CURSO, conteo: 2 },
    ]);

    expect(r.entregadas).toBe(8);
    expect(r.rechazadas).toBe(6);
    expect(r.enProceso).toBe(2);
    expect(r.total).toBe(16);
  });

  it("el caso MEDIDO `Spray Protector`: 6 rechazos de 16 órdenes son 0,375", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 8 },
      { status: "rechazada", conteo: 6 },
      { status: EN_CURSO, conteo: 2 },
    ]);

    // FRACCIÓN, no puntos: es lo que come `formatearValor(_, "porcentaje")`, que multiplica
    // por cien. Devolver 37.5 aquí pintaría «3750 %» en la tabla.
    expect(r.tasaRechazo).toBe(0.375);
  });

  it("el caso MEDIDO `Bálsamo Tensor`: 0 rechazos de 29 órdenes son 0, y NO null", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 20 },
      { status: "devuelta", conteo: 5 },
      { status: EN_CURSO, conteo: 4 },
    ]);

    expect(r.total).toBe(29);
    expect(r.rechazadas).toBe(0);
    // La aserción que separa «no rechazaron ninguna» de «no hubo órdenes».
    expect(r.tasaRechazo).toBe(0);
    expect(r.tasaRechazo).not.toBeNull();
  });

  it("R29 — el denominador INCLUYE las órdenes que siguen en proceso", () => {
    // Mismo numerador, dos universos: uno con las órdenes en curso dentro y otro sin ellas.
    // Si el denominador fueran «las cerradas», las dos tasas serían iguales (0,5) y este caso
    // pasaría por vacío. Con el universo entero, la primera es 0,25.
    const conEnProceso = calcularEfectividad([
      { status: "entregada", conteo: 5 },
      { status: "rechazada", conteo: 5 },
      { status: EN_CURSO, conteo: 10 },
    ]);
    const soloCerradas = calcularEfectividad([
      { status: "entregada", conteo: 5 },
      { status: "rechazada", conteo: 5 },
    ]);

    expect(conEnProceso.total).toBe(20);
    expect(conEnProceso.tasaRechazo).toBe(0.25);
    expect(soloCerradas.tasaRechazo).toBe(0.5);
    // Y la efectividad de entrega se mueve con el MISMO divisor: las dos son comparables.
    expect(conEnProceso.efectividad).toBe(0.25);
  });

  it("con el universo VACÍO la tasa es null, igual que sus dos hermanas", () => {
    const r = calcularEfectividad([]);

    expect(r.total).toBe(0);
    expect(r.rechazadas).toBe(0);
    expect(r.tasaRechazo).toBeNull();
    expect(r.efectividad).toBeNull();
    expect(r.efectividadGestion).toBeNull();
  });

  it("las cifras existentes NO se reinventan: la suma de los buckets sigue siendo el total", () => {
    // Los cinco desenlaces del catálogo más un estado en curso. `enProceso` se define por
    // NEGACIÓN, así que entregadas + rechazadas + enProceso NO tiene por qué dar el total:
    // faltan devueltas, reprogramadas e incidentes. Es exactamente lo que se afirma aquí, para
    // que nadie «arregle» la fórmula creyendo que no cuadra.
    const porStatus = [
      { status: "entregada", conteo: 4 },
      { status: "rechazada", conteo: 3 },
      { status: "devuelta", conteo: 2 },
      { status: "reprogramada", conteo: 1 },
      { status: "incidente", conteo: 1 },
      { status: EN_CURSO, conteo: 9 },
    ];
    const r = calcularEfectividad(porStatus);

    expect(r.total).toBe(20);
    expect(r.enProceso).toBe(9);
    expect(r.entregadas + r.rechazadas + r.enProceso).toBe(16);
    // Y `enProceso` es TODO lo que no es un desenlace, no una lista propia de estados.
    expect(DESENLACES).not.toContain(EN_CURSO);
  });

  it("la efectividad de GESTIÓN sigue siendo entregadas + rechazadas, sin tocarse", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 8 },
      { status: "rechazada", conteo: 6 },
      { status: EN_CURSO, conteo: 2 },
    ]);

    // No-regresión: la ficha 345 es ADITIVA. Si `rechazadas` se hubiera colado en el numerador
    // de otra cifra, esto lo diría.
    expect(r.efectividadGestion).toBe(14 / 16);
    expect(r.efectividad).toBe(0.5);
  });
});
