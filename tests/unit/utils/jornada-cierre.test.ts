import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { derivarJornada, jornadaDelCorte } from "@/lib/utils/jornada-cierre";
import { diaQueElCorteCierra } from "@/lib/services/CorteDiarioService";

/**
 * FEATURE 271 (T6.9 — R57/R58/R59/R60/R61) — EL DERIVADOR DE LA JORNADA DE UN CIERRE.
 *
 * POR QUE ESTE ARCHIVO EXISTE: la primera version de los literales de esta ficha nombraba el cierre
 * por su `created_at`, y ESO ESTA MEDIDO COMO MAL. Cierre `79cb2c0f` en produccion: `created_at` en
 * hora de Costa Rica = 2026-08-22; jornada real (la fecha de sus 3 gestiones vinculadas) =
 * 2026-08-21. Un dia de desfase, y no en una fila rara: el corte corre a las 00:0x de la madrugada
 * SIGUIENTE a la jornada que cierra, asi que TODO `vencido` nace fechado un dia por delante — y son
 * los `vencido` los que mas avisos generan.
 *
 * Modulo PURO: sin Prisma, sin reloj, sin borde.
 */
describe("271/T6.9 · derivarJornada — la fecha que el aviso nombra (R57-R61)", () => {
  it("(a) EL CASO MEDIDO: gestiones del 21, cierre nacido el 22 -> devuelve el 21", () => {
    // Reproduce `79cb2c0f`: 3 gestiones registradas el 21 en hora de Costa Rica y una fila de
    // cierre creada por el corte a las 00:0x del 22.
    expect(
      derivarJornada({
        diasCRDeGestiones: ["2026-08-21", "2026-08-21", "2026-08-21"],
        diaCRDeCreacion: "2026-08-22",
      }),
    ).toBe("2026-08-21");
  });

  it("(a-bis) el `created_at` NO gana a las gestiones: con gestiones, la fuente son ellas (R57)", () => {
    // Si alguien cambiara el derivador a «created_at a secas» (alternativa A8, descartada), este
    // caso devolveria "2026-08-22" y moriria. Es la contraprueba escrita como caso.
    const r = derivarJornada({
      diasCRDeGestiones: ["2026-08-21"],
      diaCRDeCreacion: "2026-08-22",
    });
    expect(r).toBe("2026-08-21");
    expect(r).not.toBe("2026-08-22");
  });

  it("(b) cierre SIN ninguna gestion (money-neutral del corte) -> `created_at` CR MENOS UN DIA (R58)", () => {
    expect(
      derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "2026-08-22" }),
    ).toBe("2026-08-21");
  });

  it("(b-bis) el fallback cruza el cambio de mes sin inventarse un dia 0", () => {
    expect(
      derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "2026-09-01" }),
    ).toBe("2026-08-31");
  });

  it("(c) gestiones en DOS dias CR -> `null`: se OMITE la fecha, no se elige una (R60)", () => {
    // No hay *una* jornada. Elegir una de las dos seria decidir por el mensajero cual de sus dos
    // dias le estamos nombrando.
    expect(
      derivarJornada({
        diasCRDeGestiones: ["2026-08-20", "2026-08-21"],
        diaCRDeCreacion: "2026-08-22",
      }),
    ).toBeNull();
  });

  it("gestiones repetidas del mismo dia colapsan a una jornada (no cuentan como «dos dias»)", () => {
    expect(
      derivarJornada({
        diasCRDeGestiones: ["2026-08-21", "2026-08-21"],
        diaCRDeCreacion: "2026-08-22",
      }),
    ).toBe("2026-08-21");
  });

  it("una fecha de creacion ilegible NO produce una fecha inventada: `null` (R60)", () => {
    expect(derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "no-es-fecha" })).toBeNull();
    // Y un dia que NO existe tampoco rueda al mes siguiente en silencio.
    expect(derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "2026-02-31" })).toBeNull();
  });
});

describe("271/T6.9 · jornadaDelCorte — coincide con el ancla de la corrida (R61)", () => {
  it("(d) el cron NORMAL (00:03 CR del 22) cierra el 21, y las dos fuentes dicen lo mismo", () => {
    // 00:03 CR del 22/08 = 06:03 UTC del 22/08.
    const now = new Date("2026-08-22T06:03:15.000Z");
    const porElAncla = jornadaDelCorte(diaQueElCorteCierra(now));
    // La rama B del derivador para ese mismo instante: `created_at` CR es el 22, menos un dia.
    const porElFallback = derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "2026-08-22" });

    expect(porElAncla).toBe("2026-08-21");
    expect(porElFallback).toBe("2026-08-21");
    expect(porElAncla).toBe(porElFallback);
  });

  it("(d-bis) el cron ADELANTADO (23:5x CR del 22) cierra el 21, y las dos fuentes SIGUEN coincidiendo", () => {
    // 23:55 CR del 22/08 = 05:55 UTC del 23/08. `startOfDayCR` da el 22 y el corte cierra el 21;
    // `created_at` en CR es el 22, menos un dia = 21. Coinciden, que es lo que R61 exige.
    const now = new Date("2026-08-23T05:55:00.000Z");
    const porElAncla = jornadaDelCorte(diaQueElCorteCierra(now));
    const porElFallback = derivarJornada({ diasCRDeGestiones: [], diaCRDeCreacion: "2026-08-22" });

    expect(porElAncla).toBe("2026-08-21");
    expect(porElAncla).toBe(porElFallback);
  });

  it("NO usa `fechaCalendarioCR` sobre el ancla: eso restaria OTRAS 6 h y daria el dia anterior", () => {
    // La trampa de las dos convenciones de fecha de este repo (ficha 166), escrita como caso.
    const now = new Date("2026-08-22T06:03:15.000Z");
    const ancla = diaQueElCorteCierra(now); // medianoche UTC de la fecha CR
    expect(jornadaDelCorte(ancla)).toBe("2026-08-21");
    // Si se aplicara el desfase otra vez, saldria el 20. Se afirma para que la mutacion muera.
    expect(jornadaDelCorte(ancla)).not.toBe("2026-08-20");
  });
});

describe("271/T6.9 · guardia — el derivador NO mira `fecha_reparto` (R59)", () => {
  it("`fechaReparto` no aparece ni una vez en el modulo del derivador", () => {
    // R59 / alternativa A9: `orden.fecha_reparto` es la fuente que el humano descarto. Falla por
    // partida doble — una orden reprogramada se libera con `fecha_reparto = null` y se reasigna a
    // otro dia, y el barrido del corte ADMITE `fecha_reparto IS NULL`—, asi que una fuente que a
    // veces es nula y a veces cambia sola no puede fechar un aviso. La guardia censa el archivo,
    // que es la unica forma de que la ausencia sea vigilada y no una promesa.
    const fuente = readFileSync("lib/utils/jornada-cierre.ts", "utf8");
    const codigo = fuente
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(codigo).not.toMatch(/fechaReparto|fecha_reparto/);
  });
});
