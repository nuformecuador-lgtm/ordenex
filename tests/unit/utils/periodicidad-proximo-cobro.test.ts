import { describe, it, expect, afterEach, vi } from "vitest";
import { aplicaHoy, proximoCobro, type PlantillaPeriodica } from "@/lib/utils/periodicidad";

// Feature 85 (R7-R12) — `proximoCobro`: la PRIMERA fecha, igual o posterior al dia calendario CR
// del instante, en la que la plantilla cobra. Logica pura con reloj INYECTADO.
//
// Las fechas de prueba se dan a mediodia CR (12:00 CR == 18:00 UTC, UTC-6) para no rozar el borde
// del dia, misma convencion que `tests/unit/utils/periodicidad.test.ts`.
//
// La guardia fuerte de este archivo NO son las fechas escritas a mano sino el BARRIDO DIFERENCIAL
// contra `aplicaHoy`: dos implementaciones independientes de la misma regla (una en cerrado, otra
// dia a dia) son un oraculo de verdad. Los casos literales estan para que un rojo diga QUE dia
// esta mal, no solo que algo lo esta.

/** 12:00 CR del dia calendario `YYYY-MM-DD` (== 18:00 UTC), lejos del borde del dia. */
function mediodiaCR(fecha: string): Date {
  return new Date(`${fecha}T18:00:00.000Z`);
}

/** Aritmetica de calendario del test (no del codigo bajo prueba): `fecha` + N dias. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function plantilla(over: Partial<PlantillaPeriodica>): PlantillaPeriodica {
  return { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-01", ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("proximoCobro — las cuatro periodicidades del pedido (R7)", () => {
  // Ancla comun 2026-09-01 (martes) e instante comun 2026-09-14, para que las cuatro respuestas
  // solo dependan del ciclo.
  const ahora = mediodiaCR("2026-09-14");

  it("devuelve la primera fecha en que la plantilla cobra, para las cuatro periodicidades del pedido", () => {
    // Diaria (1 dias): cobra todos los dias -> hoy mismo.
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-09-01" }),
        ahora,
      ),
    ).toBe("2026-09-14");

    // Semanal (1 semanas): 1, 8, 15, 22... -> el 15.
    expect(
      proximoCobro(
        plantilla({
          periodicidadUnidad: "semanas",
          periodicidadCantidad: 1,
          fechaCobro: "2026-09-01",
        }),
        ahora,
      ),
    ).toBe("2026-09-15");

    // Quincenal (2 semanas): 1, 15, 29... -> el 15.
    expect(
      proximoCobro(
        plantilla({
          periodicidadUnidad: "semanas",
          periodicidadCantidad: 2,
          fechaCobro: "2026-09-01",
        }),
        ahora,
      ),
    ).toBe("2026-09-15");

    // Mensual (1 meses): el 1 de cada mes; el de septiembre ya paso -> 1 de octubre.
    expect(
      proximoCobro(
        plantilla({
          periodicidadUnidad: "meses",
          periodicidadCantidad: 1,
          fechaCobro: "2026-09-01",
        }),
        ahora,
      ),
    ).toBe("2026-10-01");
  });

  it("tambien resuelve ciclos que no son preset: cada 3 dias y cada 6 meses", () => {
    // Cada 3 dias desde el 1: 1, 4, 7, 10, 13, 16 -> el 16.
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 3, fechaCobro: "2026-09-01" }),
        ahora,
      ),
    ).toBe("2026-09-16");

    // Cada 6 meses desde el 31/01/2026: 31/01/26, 31/07/26, 31/01/27. El 15/08/26 ya paso julio.
    expect(
      proximoCobro(
        plantilla({
          periodicidadUnidad: "meses",
          periodicidadCantidad: 6,
          fechaCobro: "2026-01-31",
        }),
        mediodiaCR("2026-08-15"),
      ),
    ).toBe("2027-01-31");
  });
});

describe("proximoCobro — antes del ancla (R8)", () => {
  it("antes del ancla el proximo cobro es el ancla", () => {
    const ahora = mediodiaCR("2026-09-14");
    for (const unidad of ["dias", "semanas", "meses"] as const) {
      expect(proximoCobro(plantilla({ periodicidadUnidad: unidad, fechaCobro: "2026-12-01" }), ahora)).toBe(
        "2026-12-01",
      );
    }
  });

  it("un ancla muy lejana sigue siendo la respuesta (no se adelanta ningun cobro)", () => {
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2030-05-07" }),
        mediodiaCR("2026-09-14"),
      ),
    ).toBe("2030-05-07");
  });
});

describe("proximoCobro — hoy dispara (R9)", () => {
  it("si hoy cobra, el proximo cobro es hoy", () => {
    // El dia exacto del ancla.
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 2, fechaCobro: "2026-09-14" }),
        mediodiaCR("2026-09-14"),
      ),
    ).toBe("2026-09-14");

    // Un disparo posterior al ancla: quincenal desde el 1 -> el 29 cobra.
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 2, fechaCobro: "2026-09-01" }),
        mediodiaCR("2026-09-29"),
      ),
    ).toBe("2026-09-29");

    // Mensual: el mismo dia del mes que el ancla.
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-03-01" }),
        mediodiaCR("2026-09-01"),
      ),
    ).toBe("2026-09-01");
  });
});

describe("proximoCobro — clamping de fin de mes (R10)", () => {
  const ancla31 = plantilla({
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-01-31",
  });

  it("ancla 31: el proximo cobro cae 28/feb, 29/feb en bisiesto y 30/abr", () => {
    expect(proximoCobro(ancla31, mediodiaCR("2026-02-01"))).toBe("2026-02-28");
    expect(proximoCobro(ancla31, mediodiaCR("2026-04-01"))).toBe("2026-04-30");
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2028-01-31" }),
        mediodiaCR("2028-02-01"),
      ),
    ).toBe("2028-02-29");
  });

  it("NO se saltea febrero: el dia clampeado ES el cobro, y el mes siguiente vuelve al 31", () => {
    expect(proximoCobro(ancla31, mediodiaCR("2026-02-28"))).toBe("2026-02-28");
    expect(proximoCobro(ancla31, mediodiaCR("2026-03-01"))).toBe("2026-03-31");
  });

  it("anclas 29 y 30 tambien se clampean en febrero", () => {
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-30" }),
        mediodiaCR("2026-02-01"),
      ),
    ).toBe("2026-02-28");
    expect(
      proximoCobro(
        plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-29" }),
        mediodiaCR("2026-02-01"),
      ),
    ).toBe("2026-02-28");
  });
});

describe("proximoCobro — barrido diferencial contra aplicaHoy (R11)", () => {
  const PLANTILLAS: PlantillaPeriodica[] = [
    // Las cuatro del pedido.
    { periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-02-10" },
    { periodicidadUnidad: "semanas", periodicidadCantidad: 1, fechaCobro: "2026-02-10" },
    { periodicidadUnidad: "semanas", periodicidadCantidad: 2, fechaCobro: "2026-02-10" },
    { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-02-10" },
    // Ciclos propios.
    { periodicidadUnidad: "dias", periodicidadCantidad: 3, fechaCobro: "2026-02-10" },
    { periodicidadUnidad: "meses", periodicidadCantidad: 6, fechaCobro: "2026-02-10" },
    // Anclas de fin de mes (el clamping).
    { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-29" },
    { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-30" },
    { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-31" },
    // Ancla en el FUTURO respecto del barrido (nunca cobra en el tramo recorrido).
    { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2028-01-31" },
  ];

  const DIAS_DEL_BARRIDO = 400;
  const INICIO = "2026-01-01";

  it("coincide con aplicaHoy: la fecha devuelta cobra y ningun dia anterior desde hoy cobra (barrido de 400 dias)", () => {
    let diasEvaluados = 0;

    for (const p of PLANTILLAS) {
      for (let i = 0; i < DIAS_DEL_BARRIDO; i += 1) {
        const hoy = sumarDias(INICIO, i);
        const siguiente = proximoCobro(p, mediodiaCR(hoy));

        // 1. La fecha devuelta es POSTERIOR O IGUAL a hoy (nunca mira hacia atras).
        expect(siguiente >= hoy).toBe(true);
        // 2. Esa fecha COBRA, segun la otra implementacion de la regla.
        expect(aplicaHoy(p, mediodiaCR(siguiente))).toBe(true);
        // 3. Y ningun dia entre hoy (incluido) y esa fecha (excluida) cobra.
        for (let d = sumarDias(hoy, 0); d < siguiente; d = sumarDias(d, 1)) {
          expect(aplicaHoy(p, mediodiaCR(d))).toBe(false);
        }

        diasEvaluados += 1;
      }
    }

    // Un bucle vacio reportaria verde sin comprobar nada: se asevera el trabajo hecho.
    expect(diasEvaluados).toBe(DIAS_DEL_BARRIDO * PLANTILLAS.length);
    expect(PLANTILLAS.length).toBe(10);
  });
});

describe("proximoCobro — reloj inyectado (R12)", () => {
  it("con dos instantes distintos del mismo dia CR devuelve lo mismo, y no usa el reloj del sistema", () => {
    // El reloj del PROCESO se pone en un dia completamente distinto: si la funcion lo leyera,
    // estas aserciones cambiarian de valor.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-11-05T12:00:00.000Z"));

    const p = plantilla({
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-09-01",
    });

    // 06:00Z = 00:00 CR del 14; 23:00Z = 17:00 CR del 14. Mismo dia calendario CR.
    expect(proximoCobro(p, new Date("2026-09-14T06:00:00.000Z"))).toBe("2026-09-15");
    expect(proximoCobro(p, new Date("2026-09-14T23:00:00.000Z"))).toBe("2026-09-15");

    // La frontera del dia CR se respeta: 05:59Z del 15 son todavia las 23:59 CR del 14 (el cobro
    // esta MANANA), y 06:00Z del 15 ya son las 00:00 CR del 15 (el cobro es HOY). Misma fecha
    // devuelta, y es la correcta en los dos lados de la frontera.
    expect(proximoCobro(p, new Date("2026-09-15T05:59:00.000Z"))).toBe("2026-09-15");
    expect(proximoCobro(p, new Date("2026-09-15T06:00:00.000Z"))).toBe("2026-09-15");
    // Un minuto despues de que el cobro del 15 quede atras (00:00 CR del 16) toca el siguiente.
    expect(proximoCobro(p, new Date("2026-09-16T06:00:00.000Z"))).toBe("2026-09-29");
  });

  it("no toca ninguna dependencia externa: mismo resultado llamado dos veces", () => {
    const p = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-31" });
    const ahora = mediodiaCR("2026-02-15");
    expect(proximoCobro(p, ahora)).toBe("2026-02-28");
    expect(proximoCobro(p, ahora)).toBe("2026-02-28");
  });
});

describe("proximoCobro — cantidad invalida (defensa del CHECK >= 1)", () => {
  it("falla fuerte y con contexto en vez de emitir una fecha invalida", () => {
    const p = plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 0, fechaCobro: "2026-01-01" });
    expect(() => proximoCobro(p, mediodiaCR("2026-09-14"))).toThrow(/periodicidadCantidad invalida/);
  });
});
