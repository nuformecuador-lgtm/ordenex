import { describe, it, expect } from "vitest";
import { TAG_OPERATIVA, TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import { ANALITICA_TAGS, tagDeDominio } from "@/lib/analytics/metrics";

// Feature 128 / T1.1 — R20/D3. Los tags salen del CATALOGO de la 135, no de un literal.

describe("R20 · los tags salen del catalogo", () => {
  it("`TAG_OPERATIVA` es exactamente `tagDeDominio(\"operativa\")`", () => {
    expect(TAG_OPERATIVA).toBe(tagDeDominio("operativa"));
    expect(TAG_OPERATIVA).toBe(ANALITICA_TAGS.operativa);
  });

  it("D3 — UN solo tag por dominio, no uno por fecha", () => {
    // Next admite 128 tags por entrada (`next/dist/lib/constants.js:280-281`) y el filtro de
    // la 135 permite rangos de hasta `RANGO_TOPE_DIAS = 366` dias: un tag por fecha revienta
    // el limite EN SILENCIO. La lista tiene uno y solo uno.
    expect(TAGS_OPERATIVA).toEqual([TAG_OPERATIVA]);
  });

  it("el tag cabe en los 256 caracteres que Next admite por tag", () => {
    expect(TAG_OPERATIVA.length).toBeLessThanOrEqual(256);
    expect(TAG_OPERATIVA.length).toBeGreaterThan(0);
  });

  it("la 128 NO cablea el tag de financiera: D2 prohibe cachear dinero", () => {
    expect(TAGS_OPERATIVA).not.toContain(ANALITICA_TAGS.financiera);
  });
});
