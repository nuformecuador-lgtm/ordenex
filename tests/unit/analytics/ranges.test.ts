import { describe, it, expect } from "vitest";
import { resolverRango } from "@/lib/analytics/ranges";
import type { EntradaRango, RangoResuelto } from "@/lib/analytics/types";

// Feature 135 / T4.2 — comportamiento de `resolverRango`.
//
// TODOS los casos pasan `now` EXPLICITO (R17): no hay `vi.useFakeTimers()` en este
// archivo, a proposito. Falsear el reloj global esconde el bug clasico —una llamada
// a `Date.now()` dentro de la funcion— en vez de detectarlo.
//
// Recordatorio de la aritmetica (Costa Rica es UTC-6 fijo, sin horario de verano):
// las 00:00 de pared de CR de la fecha `F` son el instante `F T06:00:00.000Z`. Por eso
// `now = 2026-07-15T02:00:00Z` son las 20:00 del 14 en CR y el dia CR es el 14.
//
// Nota de calendario verificada contra el propio motor de fechas: 2026-07-14 es
// MARTES (`getUTCDay() === 2`). El enunciado de R27 lo llama "miercoles"; los valores
// que R27 exige (`desdeFecha = "2026-07-13"`, el lunes) son los mismos en cualquier
// caso, porque el lunes de la semana del martes 14 es el 13. Se testean los VALORES
// del requisito, no el nombre del dia.

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** `now` canonico de R15/R27/R28: 20:00 del 14 de julio en Costa Rica. */
const NOW_CANONICO = new Date("2026-07-15T02:00:00.000Z");

const PRESETS = ["dia", "semana", "mes"] as const;

function entradaPersonalizada(desde: string, hasta: string): EntradaRango {
  return { preset: "personalizado", desde, hasta };
}

/** Casos de tabla para los invariantes: las CUATRO entradas, con cruces de mes y de anio. */
const CASOS: ReadonlyArray<{ nombre: string; entrada: EntradaRango; now: Date }> = [
  { nombre: "dia · mediados de mes", entrada: { preset: "dia" }, now: NOW_CANONICO },
  {
    nombre: "dia · cruce de anio (1 de enero en CR)",
    entrada: { preset: "dia" },
    now: new Date("2026-01-01T12:00:00.000Z"),
  },
  { nombre: "semana · mediados de mes", entrada: { preset: "semana" }, now: NOW_CANONICO },
  {
    nombre: "semana · cruce de mes (domingo 2 de agosto en CR)",
    entrada: { preset: "semana" },
    now: new Date("2026-08-02T20:00:00.000Z"),
  },
  {
    nombre: "semana · cruce de anio (sabado 3 de enero en CR)",
    entrada: { preset: "semana" },
    now: new Date("2026-01-03T12:00:00.000Z"),
  },
  { nombre: "mes · mediados de mes", entrada: { preset: "mes" }, now: NOW_CANONICO },
  {
    nombre: "mes · cruce de mes (dia 1 en CR)",
    entrada: { preset: "mes" },
    now: new Date("2026-07-01T18:00:00.000Z"),
  },
  {
    nombre: "mes · cruce de anio (5 de enero en CR)",
    entrada: { preset: "mes" },
    now: new Date("2026-01-05T12:00:00.000Z"),
  },
  {
    nombre: "personalizado · un solo dia",
    entrada: entradaPersonalizada("2026-07-14", "2026-07-14"),
    now: NOW_CANONICO,
  },
  {
    nombre: "personalizado · cruce de mes",
    entrada: entradaPersonalizada("2026-06-28", "2026-07-03"),
    now: NOW_CANONICO,
  },
  {
    nombre: "personalizado · cruce de anio, integramente pasado",
    entrada: entradaPersonalizada("2025-12-28", "2026-01-04"),
    now: NOW_CANONICO,
  },
  {
    nombre: "personalizado · anio bisiesto (29 de febrero de 2024)",
    entrada: entradaPersonalizada("2024-02-27", "2024-03-01"),
    now: NOW_CANONICO,
  },
];

/* -------------------------------------------------------------------------- */
/* R13 — ventana semiabierta [desde, hasta) + forma del resultado              */
/* -------------------------------------------------------------------------- */

describe("resolverRango · ventana semiabierta (R13)", () => {
  it("devuelve una ventana semiabierta para cada preset", () => {
    for (const preset of PRESETS) {
      const rango = resolverRango({ preset }, NOW_CANONICO);

      expect(Object.keys(rango).sort()).toEqual(
        ["preset", "desde", "hasta", "desdeFecha", "hastaFecha"].sort(),
      );
      expect(rango.preset).toBe(preset);
      expect(rango.desde).toBeInstanceOf(Date);
      expect(rango.hasta).toBeInstanceOf(Date);
      expect(rango.desdeFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rango.hastaFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // `hasta` es EXCLUSIVO: es el inicio del dia CR SIGUIENTE a `hastaFecha`,
      // asi que el instante exacto NO pertenece al rango y el milisegundo
      // anterior (23:59:59.999 CR de `hastaFecha`) si.
      expect(rango.hasta.toISOString()).toBe(
        new Date(new Date(`${rango.hastaFecha}T06:00:00.000Z`).getTime() + UN_DIA_MS).toISOString(),
      );
      expect(pertenece(rango.hasta, rango), `${preset}: hasta es EXCLUSIVO`).toBe(false);
      expect(pertenece(new Date(rango.hasta.getTime() - 1), rango)).toBe(true);
      expect(pertenece(rango.desde, rango), `${preset}: desde es INCLUSIVO`).toBe(true);
    }
  });

  it("devuelve una ventana semiabierta para un rango arbitrario", () => {
    const rango = resolverRango(entradaPersonalizada("2026-06-28", "2026-07-03"), NOW_CANONICO);

    expect(rango.preset).toBe("personalizado");
    expect(rango.desdeFecha).toBe("2026-06-28");
    expect(rango.hastaFecha).toBe("2026-07-03");
    expect(rango.desde.toISOString()).toBe("2026-06-28T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-04T06:00:00.000Z");
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(6 * UN_DIA_MS);
  });

  it("el instante `hasta` NO pertenece al rango y el anterior si", () => {
    const rango = resolverRango({ preset: "dia" }, NOW_CANONICO);

    expect(pertenece(rango.desde, rango)).toBe(true);
    expect(pertenece(new Date(rango.hasta.getTime() - 1), rango)).toBe(true);
    expect(pertenece(rango.hasta, rango)).toBe(false);
    expect(pertenece(new Date(rango.desde.getTime() - 1), rango)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R15 — preset `dia`                                                          */
/* -------------------------------------------------------------------------- */

describe("resolverRango · preset dia (R15)", () => {
  it("a las 20:00 CR del 14 el dia sigue siendo el 14, no el 15 UTC", () => {
    const rango = resolverRango({ preset: "dia" }, NOW_CANONICO);

    expect(rango.desde.toISOString()).toBe("2026-07-14T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(rango.desdeFecha).toBe("2026-07-14");
    expect(rango.hastaFecha).toBe("2026-07-14");
  });

  it("el ultimo milisegundo del dia CR (`2026-07-15T05:59:59.999Z`) sigue siendo el 14", () => {
    const rango = resolverRango({ preset: "dia" }, new Date("2026-07-15T05:59:59.999Z"));

    expect(rango.desdeFecha).toBe("2026-07-14");
    expect(rango.hastaFecha).toBe("2026-07-14");
    expect(rango.desde.toISOString()).toBe("2026-07-14T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("un milisegundo despues (`2026-07-15T06:00:00.000Z`) ya es el dia 15 en CR", () => {
    const rango = resolverRango({ preset: "dia" }, new Date("2026-07-15T06:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2026-07-15");
    expect(rango.hastaFecha).toBe("2026-07-15");
  });

  it("el dia dura exactamente 24 horas", () => {
    const rango = resolverRango({ preset: "dia" }, NOW_CANONICO);
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(UN_DIA_MS);
  });
});

/* -------------------------------------------------------------------------- */
/* R27 — preset `semana`: empieza LUNES (D2), llega hasta hoy (periodo en curso)*/
/* -------------------------------------------------------------------------- */

describe("resolverRango · preset semana (R27)", () => {
  it("la semana empieza el lunes CR y llega hasta hoy", () => {
    const rango = resolverRango({ preset: "semana" }, NOW_CANONICO);

    expect(rango.desdeFecha).toBe("2026-07-13");
    expect(rango.hastaFecha).toBe("2026-07-14");
    expect(rango.desde.toISOString()).toBe("2026-07-13T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    // Periodo EN CURSO (supuesto del spec_author, ver cabecera de ranges.ts):
    // dos dias, no los siete de la semana completa.
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(2 * UN_DIA_MS);
  });

  it("el lunes la semana dura un solo dia", () => {
    // 2026-01-05 es lunes en CR.
    const rango = resolverRango({ preset: "semana" }, new Date("2026-01-05T12:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2026-01-05");
    expect(rango.hastaFecha).toBe("2026-01-05");
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(UN_DIA_MS);
  });

  it("en domingo la semana es la que empezo el lunes anterior y dura siete dias", () => {
    // 2026-08-02 es domingo en CR (14:00 CR = 20:00 UTC).
    const rango = resolverRango({ preset: "semana" }, new Date("2026-08-02T20:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2026-07-27");
    expect(rango.hastaFecha).toBe("2026-08-02");
    expect(rango.desde.toISOString()).toBe("2026-07-27T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-08-03T06:00:00.000Z");
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(7 * UN_DIA_MS);
    // El domingo cierra la semana: NUNCA la abre (D2 fija el lunes).
    expect(new Date(`${rango.desdeFecha}T06:00:00.000Z`).getUTCDay()).toBe(1);
  });

  it("cruza el fin de mes sin aritmetica de calendario propia", () => {
    // 2026-07-01 es miercoles en CR: el lunes de su semana esta en JUNIO.
    const rango = resolverRango({ preset: "semana" }, new Date("2026-07-01T18:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2026-06-29");
    expect(rango.hastaFecha).toBe("2026-07-01");
    expect(rango.desde.toISOString()).toBe("2026-06-29T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-02T06:00:00.000Z");
  });

  it("cruza el fin de anio sin aritmetica de calendario propia", () => {
    // 2026-01-03 es sabado en CR: el lunes de su semana esta en DICIEMBRE de 2025.
    const rango = resolverRango({ preset: "semana" }, new Date("2026-01-03T12:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2025-12-29");
    expect(rango.hastaFecha).toBe("2026-01-03");
    expect(rango.desde.toISOString()).toBe("2025-12-29T06:00:00.000Z");
  });

  it("empieza SIEMPRE en lunes, cualquiera que sea el dia de la consulta", () => {
    for (let i = 0; i < 14; i += 1) {
      const now = new Date(NOW_CANONICO.getTime() + i * UN_DIA_MS);
      const rango = resolverRango({ preset: "semana" }, now);
      expect(
        new Date(`${rango.desdeFecha}T06:00:00.000Z`).getUTCDay(),
        `${rango.desdeFecha} no es lunes`,
      ).toBe(1);
      // Y nunca dura mas de siete dias.
      expect(rango.hasta.getTime() - rango.desde.getTime()).toBeLessThanOrEqual(7 * UN_DIA_MS);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — preset `mes`: ventana MOVIL de 30 dias (D3), no el mes calendario      */
/* -------------------------------------------------------------------------- */

describe("resolverRango · preset mes (R28)", () => {
  it("el preset mes es una ventana movil de 30 dias, no el mes calendario", () => {
    const rango = resolverRango({ preset: "mes" }, NOW_CANONICO);

    expect(rango.desdeFecha).toBe("2026-06-15");
    expect(rango.hastaFecha).toBe("2026-07-14");
    expect(rango.desde.toISOString()).toBe("2026-06-15T06:00:00.000Z");
    expect(rango.hasta.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(30 * 24 * 3600_000);
    // NO se alinea con el primer dia del mes calendario (seria "2026-07-01").
    expect(rango.desdeFecha).not.toBe("2026-07-01");
  });

  it("el dia 1 del mes la ventana arranca en el mes anterior", () => {
    const rango = resolverRango({ preset: "mes" }, new Date("2026-07-01T18:00:00.000Z"));

    expect(rango.hastaFecha).toBe("2026-07-01");
    expect(rango.desdeFecha).toBe("2026-06-02");
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(30 * 24 * 3600_000);
  });

  it("dura SIEMPRE 30 dias, se consulte el dia que se consulte", () => {
    for (let i = 0; i < 40; i += 1) {
      const now = new Date(NOW_CANONICO.getTime() + i * UN_DIA_MS);
      const rango = resolverRango({ preset: "mes" }, now);
      expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(30 * 24 * 3600_000);
    }
  });

  it("cruza el fin de anio sin aritmetica de calendario propia", () => {
    const rango = resolverRango({ preset: "mes" }, new Date("2026-01-05T12:00:00.000Z"));

    expect(rango.desdeFecha).toBe("2025-12-07");
    expect(rango.hastaFecha).toBe("2026-01-05");
  });

  it("convive con la semana sin homogeneizarse: una tiene borde de calendario y la otra no", () => {
    // La tension esta declarada A PROPOSITO (D2 + D3, design.md §4.3): `semana`
    // se ancla al lunes y dura entre 1 y 7 dias; `mes` es movil y dura siempre 30.
    const domingo = new Date("2026-08-02T20:00:00.000Z");
    const semana = resolverRango({ preset: "semana" }, domingo);
    const mes = resolverRango({ preset: "mes" }, domingo);

    expect(semana.hasta.getTime() - semana.desde.getTime()).toBe(7 * UN_DIA_MS);
    expect(mes.hasta.getTime() - mes.desde.getTime()).toBe(30 * UN_DIA_MS);
    expect(mes.desdeFecha).toBe("2026-07-04"); // ni lunes ni dia 1
    expect(new Date(`${mes.desdeFecha}T06:00:00.000Z`).getUTCDay()).not.toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R16 — invariantes de toda ventana                                           */
/* -------------------------------------------------------------------------- */

describe("resolverRango · invariantes de toda ventana (R16)", () => {
  it.each(CASOS)("cumple los invariantes (b)-(e) para toda entrada: $nombre", ({ entrada, now }) => {
    const rango = resolverRango(entrada, now);

    // (b) empieza y termina exactamente en una frontera de dia de Costa Rica.
    expect(rango.desde.toISOString()).toMatch(/T06:00:00\.000Z$/);
    expect(rango.hasta.toISOString()).toMatch(/T06:00:00\.000Z$/);
    expect(rango.desde.toISOString()).toBe(`${rango.desdeFecha}T06:00:00.000Z`);

    // (c) dura un numero ENTERO de dias.
    const duracion = rango.hasta.getTime() - rango.desde.getTime();
    expect(duracion % UN_DIA_MS).toBe(0);
    expect(duracion / UN_DIA_MS).toBeGreaterThanOrEqual(1);

    // (d) desde < hasta.
    expect(rango.desde.getTime()).toBeLessThan(rango.hasta.getTime());

    // (e) determinismo: la misma entrada da la misma ventana en llamadas sucesivas.
    const otra = resolverRango(entrada, now);
    expect(serializar(otra)).toEqual(serializar(rango));
  });

  it("contiene a now solo para los tres presets", () => {
    for (const preset of PRESETS) {
      const rango = resolverRango({ preset }, NOW_CANONICO);
      expect(rango.desde.getTime(), `${preset}: desde <= now`).toBeLessThanOrEqual(
        NOW_CANONICO.getTime(),
      );
      expect(rango.hasta.getTime(), `${preset}: now < hasta`).toBeGreaterThan(
        NOW_CANONICO.getTime(),
      );
    }

    // El rango arbitrario NO tiene por que contener a `now`: puede ser
    // integramente pasado (por eso R16(a) se exige solo a los presets).
    const pasado = resolverRango(entradaPersonalizada("2025-12-28", "2026-01-04"), NOW_CANONICO);
    expect(pasado.hasta.getTime()).toBeLessThan(NOW_CANONICO.getTime());
  });

  it("el rango arbitrario respeta las fechas que fija el cliente, sin desplazarlas", () => {
    const rango = resolverRango(entradaPersonalizada("2024-02-27", "2024-03-01"), NOW_CANONICO);

    expect(rango.desdeFecha).toBe("2024-02-27");
    expect(rango.hastaFecha).toBe("2024-03-01");
    // 27, 28, 29 (bisiesto) y 1 de marzo: cuatro dias.
    expect(rango.hasta.getTime() - rango.desde.getTime()).toBe(4 * UN_DIA_MS);
  });
});

/* -------------------------------------------------------------------------- */
/* R17 — `now` inyectable, sin relojes falsos                                  */
/* -------------------------------------------------------------------------- */

describe("resolverRango · now inyectable (R17)", () => {
  it("acepta now explicito sin falsear el reloj global", () => {
    // Este archivo no llama a `vi.useFakeTimers()` en ningun punto: el instante
    // entra por parametro. Dos `now` distintos dan ventanas distintas.
    const ayer = resolverRango({ preset: "dia" }, new Date("2026-07-15T02:00:00.000Z"));
    const hoy = resolverRango({ preset: "dia" }, new Date("2026-07-16T02:00:00.000Z"));

    expect(ayer.desdeFecha).toBe("2026-07-14");
    expect(hoy.desdeFecha).toBe("2026-07-15");
  });

  it("usa el instante actual cuando no se pasa now", () => {
    const antes = new Date();
    const rango = resolverRango({ preset: "dia" });
    const despues = new Date();

    expect(rango.desde.getTime()).toBeLessThanOrEqual(antes.getTime());
    expect(rango.hasta.getTime()).toBeGreaterThan(despues.getTime());
  });
});

/* -------------------------------------------------------------------------- */
/* R18 — independiente del huso horario del proceso                            */
/* -------------------------------------------------------------------------- */

describe("resolverRango · independiente del TZ del proceso (R18)", () => {
  it("da el mismo resultado con TZ=UTC y con TZ=Asia/Tokyo", () => {
    const tzOriginal = process.env.TZ;
    try {
      const porTz: Record<string, string[]> = {};
      for (const tz of ["UTC", "Asia/Tokyo", "America/Costa_Rica"]) {
        process.env.TZ = tz;
        porTz[tz] = CASOS.map(({ entrada, now }) => serializar(resolverRango(entrada, now)));
      }
      expect(porTz["Asia/Tokyo"]).toEqual(porTz["UTC"]);
      expect(porTz["America/Costa_Rica"]).toEqual(porTz["UTC"]);
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R31 — dia natural de Costa Rica 00:00-24:00 (D6), NO la convencion 18:00     */
/* -------------------------------------------------------------------------- */

describe("resolverRango · dia natural de Costa Rica (R31)", () => {
  it("usa el dia natural de Costa Rica 00:00-24:00", () => {
    for (const { entrada, now } of CASOS) {
      const rango = resolverRango(entrada, now);
      for (const borde of [rango.desde, rango.hasta]) {
        // 00:00 de pared en CR = 06:00 UTC. La medianoche UTC seria la convencion
        // `@db.Date` (feature 46) que usa el ranking: ventana 18:00-18:00 CR, la
        // que D6 descarto explicitamente para la analitica.
        expect(borde.toISOString().endsWith("T06:00:00.000Z")).toBe(true);
        expect(borde.toISOString().endsWith("T00:00:00.000Z")).toBe(false);
        expect(borde.getUTCHours()).toBe(6);
        expect(borde.getUTCMinutes()).toBe(0);
        expect(borde.getUTCSeconds()).toBe(0);
        expect(borde.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  it("una gestion de las 19:00 CR cae en el dia CR correcto, no en el siguiente", () => {
    // 2026-07-15T01:00:00Z = 19:00 CR del 14. Con la convencion 18:00-18:00 del
    // ranking, este instante ya contaria para el "dia 15". Aqui cuenta para el 14.
    const gestion = new Date("2026-07-15T01:00:00.000Z");
    const rango = resolverRango({ preset: "dia" }, gestion);

    expect(rango.hastaFecha).toBe("2026-07-14");
    expect(gestion >= rango.desde && gestion < rango.hasta).toBe(true);
  });
});

/** Membresia en la ventana SEMIABIERTA `[desde, hasta)` (R13). */
function pertenece(instante: Date, rango: RangoResuelto): boolean {
  return instante.getTime() >= rango.desde.getTime() && instante.getTime() < rango.hasta.getTime();
}

function serializar(rango: RangoResuelto): string {
  return [
    rango.preset,
    rango.desde.toISOString(),
    rango.hasta.toISOString(),
    rango.desdeFecha,
    rango.hastaFecha,
  ].join("|");
}
