import { describe, it, expect } from "vitest";

import {
  esFechaCalendarioValida,
  fechaCalendarioCR,
  mananaCalendarioCR,
  ultimosNDiasCalendarioCR,
} from "@/lib/utils/fecha-cr";

// Regresión (off-by-one por zona horaria): `new Date().toISOString().slice(0, 10)`
// emite la fecha en UTC, así que a partir de las 18:00 de CR (UTC-6) ya devuelve el
// día SIGUIENTE. Estos casos fijan la convención de CR en el borde del día.

describe("fechaCalendarioCR", () => {
  it("de noche en CR sigue siendo el MISMO día, aunque en UTC ya sea el siguiente", () => {
    // 20:00 CR del 15 = 02:00 UTC del 16. `toISOString()` habría dicho "2026-07-16".
    expect(fechaCalendarioCR(new Date("2026-07-16T02:00:00.000Z"))).toBe(
      "2026-07-15",
    );
  });

  it("un minuto antes de medianoche CR todavía es el día que termina", () => {
    // 23:59 CR del 14 = 05:59 UTC del 15.
    expect(fechaCalendarioCR(new Date("2026-07-15T05:59:00.000Z"))).toBe(
      "2026-07-14",
    );
  });

  it("a medianoche CR ya es el día nuevo", () => {
    // 00:00 CR del 15 = 06:00 UTC del 15.
    expect(fechaCalendarioCR(new Date("2026-07-15T06:00:00.000Z"))).toBe(
      "2026-07-15",
    );
  });

  it("cruza el cambio de mes por el calendario de CR, no por el de UTC", () => {
    // 19:00 CR del 31 jul = 01:00 UTC del 1 ago.
    expect(fechaCalendarioCR(new Date("2026-08-01T01:00:00.000Z"))).toBe(
      "2026-07-31",
    );
  });
});

describe("mananaCalendarioCR", () => {
  it("de noche en CR devuelve el día siguiente, NO dos días después", () => {
    // El bug original: 20:00 CR del 15 daba "2026-07-17" (UTC ya era 16, +1 = 17).
    expect(mananaCalendarioCR(new Date("2026-07-16T02:00:00.000Z"))).toBe(
      "2026-07-16",
    );
  });

  it("de mañana en CR devuelve el día siguiente", () => {
    // 08:00 CR del 15 = 14:00 UTC del 15.
    expect(mananaCalendarioCR(new Date("2026-07-15T14:00:00.000Z"))).toBe(
      "2026-07-16",
    );
  });

  it("desde el último día del mes salta al primero del siguiente", () => {
    expect(mananaCalendarioCR(new Date("2026-07-31T14:00:00.000Z"))).toBe(
      "2026-08-01",
    );
  });
});

// La pieza COMPARTIDA del round-trip, probada a su nivel y no solo a través de sus dos
// llamadores (`esFechaFutura` de la reprogramación y `esFechaPagoValida` de la liquidación).
describe("esFechaCalendarioValida", () => {
  it.each(["2026-02-31", "2026-04-31", "2026-02-30", "2027-02-29"])(
    "rechaza %s: el día desbordado RUEDA en V8, no da Invalid Date",
    (fecha) => {
      expect(esFechaCalendarioValida(fecha)).toBe(false);
    },
  );

  it.each(["2026-13-01", "2026-00-10", "20260715", "2026-7-15", "ayer", ""])(
    "rechaza %s por forma o por mes fuera de rango",
    (fecha) => {
      expect(esFechaCalendarioValida(fecha)).toBe(false);
    },
  );

  it.each(["2026-02-28", "2028-02-29", "2026-04-30", "2026-12-31", "2026-01-01"])(
    "acepta %s",
    (fecha) => {
      expect(esFechaCalendarioValida(fecha)).toBe(true);
    },
  );
});

describe("ultimosNDiasCalendarioCR", () => {
  it("cuenta N días calendario INCLUIDO hoy (retrocede N - 1)", () => {
    // 08:00 CR del 15 jul. "Últimos 7 días" = del 9 al 15, ambos incluidos.
    expect(ultimosNDiasCalendarioCR(7, new Date("2026-07-15T14:00:00.000Z"))).toEqual({
      desde: "2026-07-09",
      hasta: "2026-07-15",
    });
  });

  it("de noche en CR no adelanta el rango un día (usa el calendario de CR)", () => {
    // 20:00 CR del 15 = 02:00 UTC del 16: el rango sigue terminando el 15.
    expect(ultimosNDiasCalendarioCR(30, new Date("2026-07-16T02:00:00.000Z"))).toEqual({
      desde: "2026-06-16",
      hasta: "2026-07-15",
    });
  });

  it("un solo día deja los dos extremos en hoy", () => {
    expect(ultimosNDiasCalendarioCR(1, new Date("2026-07-15T14:00:00.000Z"))).toEqual({
      desde: "2026-07-15",
      hasta: "2026-07-15",
    });
  });
});
