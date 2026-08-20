import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { resolverFechaReparto } from "@/lib/utils/dia-reparto";
import { inicioDelDiaCREnUtc, startOfDayCR } from "@/lib/utils/fecha-cr";

// Feature 246 (T1.3, R5/R17) — «hoy» y «mañana» resueltos EN EL SERVIDOR, con reloj inyectado.
//
// ESTE ARCHIVO EXISTE POR EL RIESGO 3 DEL DISEÑO: usar el helper de fecha equivocado desplaza el
// dia seis horas y devuelve el defecto por otra puerta. El repo tiene DOS convenciones vivas:
//
//   - `startOfDayCR(now)`        -> MEDIANOCHE UTC de la fecha calendario CR. Es la de las columnas
//                                   `@db.Date` (feature 46), y por tanto la de `fecha_reparto`.
//   - `inicioDelDiaCREnUtc(f)`   -> `${f}T06:00:00.000Z`. Es la de las columnas `timestamp`
//                                   (`asignado_at`, `gestion_orden.created_at`, features 144/166).
//
// Los casos van a AMBOS lados de las DOS fronteras que este repo confunde: las 00:00 de PARED en
// Costa Rica (= 06:00Z) y la medianoche UTC (= 18:00 CR del dia anterior).

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const d = (iso: string) => new Date(iso);

describe("resolverFechaReparto — la frontera de las 00:00 CR (= 06:00Z)", () => {
  it("23:59 CR del 20 (05:59Z del 21): «hoy» es el 20", () => {
    const now = d("2026-08-21T05:59:00.000Z");
    expect(resolverFechaReparto("hoy", now).toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("23:59 CR del 20: «mañana» es el 21 — un dia justo, no seis horas", () => {
    const now = d("2026-08-21T05:59:00.000Z");
    expect(resolverFechaReparto("manana", now).toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("00:01 CR del 21 (06:01Z): «hoy» ya es el 21 y «mañana» el 22", () => {
    const now = d("2026-08-21T06:01:00.000Z");
    expect(resolverFechaReparto("hoy", now).toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(resolverFechaReparto("manana", now).toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("05:59Z y 06:01Z del mismo dia caen en dias CR DISTINTOS (es la frontera real)", () => {
    const antes = resolverFechaReparto("hoy", d("2026-08-21T05:59:00.000Z"));
    const despues = resolverFechaReparto("hoy", d("2026-08-21T06:01:00.000Z"));
    expect(despues.getTime() - antes.getTime()).toBe(UN_DIA_MS);
  });
});

describe("resolverFechaReparto — la frontera de la medianoche UTC (18:00 CR)", () => {
  it("18:00 CR del 20 (00:00Z del 21): sigue siendo el 20, no el 21", () => {
    // Es el off-by-one clasico de `toISOString().slice(0,10)`: en UTC ya es dia 21.
    const now = d("2026-08-21T00:00:00.000Z");
    expect(resolverFechaReparto("hoy", now).toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(resolverFechaReparto("manana", now).toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("17:59 CR y 18:01 CR del mismo dia dan LA MISMA fecha de reparto", () => {
    const antes = resolverFechaReparto("manana", d("2026-08-20T23:59:00.000Z"));
    const despues = resolverFechaReparto("manana", d("2026-08-21T00:01:00.000Z"));
    expect(antes.toISOString()).toBe(despues.toISOString());
  });
});

describe("resolverFechaReparto — la convencion, dicha explicitamente (R17, riesgo 3)", () => {
  it("«hoy» es EXACTAMENTE `startOfDayCR(now)`: la convencion `@db.Date` del repo", () => {
    const now = d("2026-08-20T20:00:00.000Z");
    expect(resolverFechaReparto("hoy", now).getTime()).toBe(startOfDayCR(now).getTime());
  });

  it("NO usa `inicioDelDiaCREnUtc`: la fecha resuelta NO lleva las 06:00 dentro", () => {
    // El caso que impide el error del riesgo 3. Si alguien cambiara el helper, la fecha saldria
    // seis horas mas tarde y la comparacion contra la columna `DATE` se iria un dia.
    const now = d("2026-08-20T20:00:00.000Z");
    const resuelta = resolverFechaReparto("hoy", now);
    expect(resuelta.getUTCHours()).toBe(0);
    expect(resuelta.getUTCMinutes()).toBe(0);
    expect(resuelta.getUTCSeconds()).toBe(0);
    expect(resuelta.getUTCMilliseconds()).toBe(0);
    expect(resuelta.getTime()).not.toBe(inicioDelDiaCREnUtc("2026-08-20").getTime());
    expect(inicioDelDiaCREnUtc("2026-08-20").getTime() - resuelta.getTime()).toBe(
      6 * 60 * 60 * 1000,
    );
  });

  it("«mañana» es exactamente un dia despues de «hoy», siempre (CR no tiene horario de verano)", () => {
    for (const iso of [
      "2026-01-01T00:00:00.000Z",
      "2026-03-08T09:00:00.000Z", // fin de semana del cambio de hora en EE. UU.: en CR no pasa nada
      "2026-08-20T20:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-12-31T23:59:59.000Z",
    ]) {
      const now = d(iso);
      expect(
        resolverFechaReparto("manana", now).getTime() - resolverFechaReparto("hoy", now).getTime(),
      ).toBe(UN_DIA_MS);
    }
  });

  it("cruza fin de mes y fin de año sin inventar dias", () => {
    expect(resolverFechaReparto("manana", d("2026-08-31T20:00:00.000Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(resolverFechaReparto("manana", d("2026-12-31T20:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("R17 — la fuente no introduce una segunda definicion del dia", () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "utils", "dia-reparto.ts"),
    "utf8",
  );
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("no usa `inicioDelDiaCREnUtc` en el CODIGO (nombrarla en el comentario es obligatorio)", () => {
    expect(fuente).toContain("inicioDelDiaCREnUtc"); // la trampa se NOMBRA
    expect(codigo).not.toContain("inicioDelDiaCREnUtc"); // pero no se USA
  });

  it("no hace aritmetica de zona horaria a mano (el offset vive en `fecha-cr.ts`)", () => {
    const sinEspacios = codigo.replace(/\s+/g, "");
    expect(sinEspacios).not.toContain("6*60*60*1000");
    expect(sinEspacios).not.toContain("21600000");
    expect(sinEspacios).not.toContain("getTimezoneOffset");
    expect(sinEspacios).not.toContain("America/Costa_Rica");
  });

  it("el censo detecta lo que dice detectar (autocomprobacion)", () => {
    const sospechoso = "const x = inicioDelDiaCREnUtc(f); const OFF = 6 * 60 * 60 * 1000;";
    const limpio = sospechoso.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(limpio).toContain("inicioDelDiaCREnUtc");
    expect(limpio.replace(/\s+/g, "")).toContain("6*60*60*1000");
  });
});
