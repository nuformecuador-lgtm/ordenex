import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  fechaComoDate,
  fechaObjetivo,
  validarFechaInvocacionManual,
  ventanaDelDia,
} from "@/lib/analytics/rollup-dia";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";

// Feature 124 / T1.1 — la fecha objetivo del rollup y sus cotas (R5-R9, R24, R39).
//
// Todo con el reloj CONGELADO y pasado por parametro: si alguien mete un `new Date()` en la
// ruta de calculo, estos casos dejan de controlar la fecha y se ponen rojos (R8).

const ROOT = path.join(__dirname, "..", "..", "..");

/**
 * El codigo del archivo SIN comentarios. La cabecera del modulo NOMBRA `startOfDayCR` a
 * proposito para explicar por que esta prohibida; esa prosa no es una importacion.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FUENTE_ROLLUP_DIA = sinComentarios(
  fs.readFileSync(path.join(ROOT, "lib/analytics/rollup-dia.ts"), "utf8"),
);

describe("R5/R8 — fechaObjetivo: la corrida agrega el dia que ACABA DE CERRAR (D-1)", () => {
  it("con el reloj a las 00:30 CR del dia siguiente devuelve el dia que cerro", () => {
    // 06:30 UTC = 00:30 CR. Es el horario que fija D3 para la corrida programada.
    expect(fechaObjetivo(new Date("2026-07-16T06:30:00.000Z"))).toBe("2026-07-15");
  });

  it("a las 23:59:59 CR del 15 el dia cerrado sigue siendo el 14", () => {
    // 2026-07-16T05:59:59.999Z == 23:59:59.999 CR del 15.
    expect(fechaObjetivo(new Date("2026-07-16T05:59:59.999Z"))).toBe("2026-07-14");
  });

  it("a las 00:00:00 CR del 16 —el instante exacto del corte— el dia cerrado pasa a ser el 15", () => {
    expect(fechaObjetivo(new Date("2026-07-16T06:00:00.000Z"))).toBe("2026-07-15");
  });

  it("cruza el cambio de mes y el de anio sin off-by-one", () => {
    expect(fechaObjetivo(new Date("2026-08-01T06:30:00.000Z"))).toBe("2026-07-31");
    expect(fechaObjetivo(new Date("2027-01-01T06:30:00.000Z"))).toBe("2026-12-31");
    // 2026-03-01T06:30Z = 00:30 CR del 1 de marzo -> cierra el 28 de febrero (no bisiesto).
    expect(fechaObjetivo(new Date("2026-03-01T06:30:00.000Z"))).toBe("2026-02-28");
  });

  it("NO agrega el dia en curso: la fecha objetivo nunca es la fecha CR de `now`", () => {
    // Segunda mutacion de R5: si la corrida de las 00:30 CR agregara el dia en curso, esto
    // devolveria "2026-07-16".
    expect(fechaObjetivo(new Date("2026-07-16T06:30:00.000Z"))).not.toBe("2026-07-16");
  });
});

describe("R9 — el resultado NO depende de la variable de entorno TZ", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it("da la misma fecha objetivo y la misma ventana con TZ de CR, de Tokio y UTC", () => {
    const now = new Date("2026-07-16T06:30:00.000Z");
    const observados: string[] = [];
    const ventanas: string[] = [];
    for (const tz of ["UTC", "America/Costa_Rica", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      observados.push(fechaObjetivo(now));
      const v = ventanaDelDia("2026-07-15");
      ventanas.push(`${v.desde.toISOString()}|${v.hasta.toISOString()}`);
    }
    expect(new Set(observados)).toEqual(new Set(["2026-07-15"]));
    expect(new Set(ventanas).size).toBe(1);
  });
});

describe("R5/R7/R24 — la ventana del dia y su corte", () => {
  const ventana = ventanaDelDia("2026-07-15");

  it("es exactamente [D T06:00:00Z, D+1 T06:00:00Z)", () => {
    expect(ventana.desde.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(ventana.hasta.toISOString()).toBe("2026-07-16T06:00:00.000Z");
    expect(ventana.hasta.getTime() - ventana.desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("sale de `fecha-cr.ts` y no de aritmetica propia (R6)", () => {
    expect(ventana.desde.getTime()).toBe(inicioDelDiaCREnUtc("2026-07-15").getTime());
    expect(ventana.hasta.getTime()).toBe(inicioDelDiaSiguienteCREnUtc("2026-07-15").getTime());
  });

  it("la orden de las 23:59:59 CR entra y la de las 00:00:00 CR del dia siguiente no (R7)", () => {
    const ultimaDelDia = new Date("2026-07-16T05:59:59.000Z"); // 23:59:59 CR del 15
    const primeraDelSiguiente = new Date("2026-07-16T06:00:00.000Z"); // 00:00:00 CR del 16
    expect(ultimaDelDia.getTime()).toBeGreaterThanOrEqual(ventana.desde.getTime());
    expect(ultimaDelDia.getTime()).toBeLessThan(ventana.hasta.getTime());
    expect(primeraDelSiguiente.getTime()).toBeGreaterThanOrEqual(ventana.hasta.getTime());
  });

  it("la transicion `corte_sin_gestionar` cae EXACTAMENTE en el corte, que es cota ESTRICTA (R24)", () => {
    // El corte diario escribe sus transiciones a las 00:00:00 CR del dia siguiente. Con `<`
    // quedan FUERA del cierre de D; con `<=` entrarian y moverian el embudo un dia entero.
    const transicionDelCorte = new Date("2026-07-16T06:00:00.000Z");
    expect(transicionDelCorte.getTime()).toBe(ventana.hasta.getTime());
    expect(transicionDelCorte.getTime() < ventana.hasta.getTime()).toBe(false);
  });

  it("la cota inferior NO es la medianoche UTC: `startOfDayCR` daria la ventana 18:00-18:00", () => {
    // La trampa documentada del repo (ficha 166). `fechaComoDate` es la convencion @db.Date y
    // esta SEIS HORAS por debajo del comienzo real del dia en CR.
    expect(fechaComoDate("2026-07-15").toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(ventana.desde.getTime() - fechaComoDate("2026-07-15").getTime()).toBe(
      6 * 60 * 60 * 1000,
    );
    expect(ventana.desde.getTime()).not.toBe(fechaComoDate("2026-07-15").getTime());
  });
});

describe("R6 — el modulo del dia no importa `startOfDayCR` ni reimplementa zonas horarias", () => {
  it("no hay ninguna importacion de `startOfDayCR` en `lib/analytics/rollup-dia.ts`", () => {
    expect(FUENTE_ROLLUP_DIA).not.toMatch(/startOfDayCR/);
  });

  it("no hay ningun `new Date()` ni `Date.now()` sin argumento en la ruta de calculo (R8)", () => {
    expect(FUENTE_ROLLUP_DIA).not.toMatch(/new Date\(\s*\)/);
    expect(FUENTE_ROLLUP_DIA).not.toMatch(/Date\.now\(/);
  });
});

describe("R39 — la invocacion manual admite SOLO hoy o ayer", () => {
  // 00:30 CR del 16 de julio: hoy = 2026-07-16, ayer (el dia cerrado) = 2026-07-15.
  const now = new Date("2026-07-16T06:30:00.000Z");

  it("acepta el dia en curso", () => {
    expect(validarFechaInvocacionManual("2026-07-16", now)).toEqual({
      ok: true,
      fecha: "2026-07-16",
    });
  });

  it("acepta el dia que acaba de cerrar", () => {
    expect(validarFechaInvocacionManual("2026-07-15", now)).toEqual({
      ok: true,
      fecha: "2026-07-15",
    });
  });

  it("rechaza `hoy - 10 dias` remitiendo al backfill de la 125", () => {
    const r = validarFechaInvocacionManual("2026-07-06", now);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("inalcanzable");
    expect(r.motivo).toContain("2026-07-06");
    expect(r.motivo).toMatch(/125/);
  });

  it("rechaza tambien anteayer: el limite es ayer, no «los ultimos dias»", () => {
    expect(validarFechaInvocacionManual("2026-07-14", now).ok).toBe(false);
  });

  it("rechaza una fecha futura: un dia que no ha cerrado no tiene rollup", () => {
    const r = validarFechaInvocacionManual("2026-07-17", now);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("inalcanzable");
    expect(r.motivo).toMatch(/futura/);
  });

  it("rechaza lo que no sea `YYYY-MM-DD` en vez de intentar interpretarlo", () => {
    for (const basura of ["", "15/07/2026", "2026-7-5", "2026-07-15T00:00:00Z", "ayer"]) {
      expect(validarFechaInvocacionManual(basura, now).ok).toBe(false);
    }
  });
});
