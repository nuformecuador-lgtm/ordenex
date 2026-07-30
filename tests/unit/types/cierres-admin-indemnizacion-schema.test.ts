import { describe, it, expect } from "vitest";
import { aprobarCierreSchema } from "@/lib/types/cierres-admin";

// Feature 158 (T1.11, R20/R24/R36) — el BORDE de la captura de indemnizaciones al aprobar un
// cierre. Aqui vive la validacion de FORMA del monto; la COBERTURA (que haya un monto por cada
// gestion `incidente` del cierre, ni mas ni menos) la valida el service, que es quien sabe que
// gestiones tiene ese cierre.
//
// Money-safe (R24): el monto viaja STRING de extremo a extremo. Este archivo lo fija: el schema
// NO coacciona a number, y un `number` en la entrada se RECHAZA.

const CIERRE = "11111111-1111-4111-8111-111111111111";
const GESTION = "22222222-2222-4222-8222-222222222222";

describe("R36 — el contrato de la 38 sigue siendo valido tal cual", () => {
  it("sin `indemnizaciones` -> valido, con la lista por defecto VACIA", () => {
    const r = aprobarCierreSchema.safeParse({ cierreId: CIERRE });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.indemnizaciones).toEqual([]);
  });

  it("con `indemnizaciones: []` explicito -> valido (cierre sin incidentes)", () => {
    const r = aprobarCierreSchema.safeParse({ cierreId: CIERRE, indemnizaciones: [] });
    expect(r.success).toBe(true);
  });

  it("un cierreId que no es uuid sigue siendo invalido (la 158 no afloja la 38)", () => {
    expect(aprobarCierreSchema.safeParse({ cierreId: "no-uuid" }).success).toBe(false);
  });
});

describe("R19/R24 — una indemnizacion valida", () => {
  it("acepta gestionId uuid + monto STRING con 2 decimales", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: GESTION, monto: "12500.75" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.indemnizaciones[0].monto).toBe("12500.75");
      // R24: sigue siendo STRING despues de parsear. Nunca number.
      expect(typeof r.data.indemnizaciones[0].monto).toBe("string");
    }
  });

  it("acepta varias entradas (un monto por incidente del cierre)", () => {
    const otra = "33333333-3333-4333-8333-333333333333";
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [
        { gestionId: GESTION, monto: "1.00" },
        { gestionId: otra, monto: "2.50" },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.indemnizaciones).toHaveLength(2);
  });
});

describe("R20/R24 — montos invalidos: el borde los rechaza", () => {
  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["negativo", "-100.00"],
    ["tres decimales", "10.005"],
    ["con coma decimal", "10,50"],
    ["no numerico", "mil colones"],
    ["notacion cientifica", "1e3"],
    ["con simbolo de moneda", "₡100.00"],
    ["con separador de miles", "1,000.00"],
  ])("rechaza el monto %s", (_caso, monto) => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: GESTION, monto }],
    });
    expect(r.success).toBe(false);
  });

  it("R24: un monto NUMBER se rechaza (no hay coercion a string)", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: GESTION, monto: 100.5 }],
    });
    expect(r.success).toBe(false);
  });

  it("R20: un monto ausente se rechaza", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: GESTION }],
    });
    expect(r.success).toBe(false);
  });

  it("R21: un gestionId que no es uuid se rechaza en el borde", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [{ gestionId: "g1", monto: "10.00" }],
    });
    expect(r.success).toBe(false);
  });

  it("el error cuelga del indice de la entrada invalida (la UI lo pinta por fila)", () => {
    const r = aprobarCierreSchema.safeParse({
      cierreId: CIERRE,
      indemnizaciones: [
        { gestionId: GESTION, monto: "10.00" },
        { gestionId: "33333333-3333-4333-8333-333333333333", monto: "0" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const rutas = r.error.issues.map((i) => i.path.join("."));
      expect(rutas.some((p) => p.startsWith("indemnizaciones.1"))).toBe(true);
      expect(rutas.some((p) => p.startsWith("indemnizaciones.0"))).toBe(false);
    }
  });
});
