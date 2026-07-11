import { describe, it, expect } from "vitest";
import { normalizeZonaKey, canonicalZonaNombre } from "@/lib/geo/normalize";

// Feature 24 (design §5.1). Clave de dedup (R2/R21/R35) y forma canonica.

describe("normalizeZonaKey — clave de deduplicacion (R2/R35)", () => {
  it("colapsa mayusculas/minusculas: GAM y Gam producen la misma clave", () => {
    expect(normalizeZonaKey("GAM")).toBe("gam");
    expect(normalizeZonaKey("Gam")).toBe("gam");
    expect(normalizeZonaKey("GAM")).toBe(normalizeZonaKey("Gam"));
  });

  it("quita acentos: LIMON ABAJO y LIMÓN ABAJO producen la misma clave", () => {
    expect(normalizeZonaKey("LIMON ABAJO")).toBe("limon abajo");
    expect(normalizeZonaKey("LIMÓN ABAJO")).toBe("limon abajo");
    expect(normalizeZonaKey("LIMÓN ABAJO")).toBe(normalizeZonaKey("LIMON ABAJO"));
  });

  it("recorta y colapsa espacios internos", () => {
    expect(normalizeZonaKey("  Zona   Sur  ")).toBe("zona sur");
    expect(normalizeZonaKey("ZONA SUR")).toBe(normalizeZonaKey("Zona Sur"));
  });

  it("devuelve null para vacio o solo espacios (distrito sin zona, R36)", () => {
    expect(normalizeZonaKey("")).toBeNull();
    expect(normalizeZonaKey("   ")).toBeNull();
    expect(normalizeZonaKey(null)).toBeNull();
    expect(normalizeZonaKey(undefined)).toBeNull();
  });
});

describe("canonicalZonaNombre — forma mostrada (R2/R35)", () => {
  it("Title Case por palabra", () => {
    expect(canonicalZonaNombre("ZONA SUR")).toBe("Zona Sur");
    expect(canonicalZonaNombre("zona sur")).toBe("Zona Sur");
    expect(canonicalZonaNombre("LIMON ABAJO")).toBe("Limon Abajo");
  });

  it("conserva acronimos reconocidos en mayusculas (GAM)", () => {
    expect(canonicalZonaNombre("gam")).toBe("GAM");
    expect(canonicalZonaNombre("GAM")).toBe("GAM");
    expect(canonicalZonaNombre("Gam")).toBe("GAM");
  });

  it("recorta y colapsa espacios; null para vacio", () => {
    expect(canonicalZonaNombre("  san   ramon ")).toBe("San Ramon");
    expect(canonicalZonaNombre("  ")).toBeNull();
  });
});
