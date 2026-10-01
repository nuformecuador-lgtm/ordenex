import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { METRICAS_API_KEY } from "@/lib/analytics/publicacion-api-key";
import { openApiSpec } from "@/lib/api/openapi-spec";

/**
 * FICHA 466 (T1.5; R16, R17, R18, R19) — el contrato llama «Flete por devolución a origen» al flete
 * del escenario devuelto, nombra el resultado por su codigo o nombre vigente (no «RECHAZADA») y NO
 * cambia ningun campo, valor ni id por ello. Los textos son LITERALES escritos a mano: son el contrato
 * (design D3), no se comparan contra su propia fuente.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const YAML = leer("docs/api/api-key-openapi.yaml");
const CHANGELOG = leer("docs/api/CHANGELOG.md");

type Nodo = Record<string, unknown>;
const schemas = (openApiSpec as unknown as { components: { schemas: Record<string, Nodo> } }).components.schemas;
const devuelto = schemas.CotizacionEscenarioDevuelto as Nodo & { properties: Record<string, Nodo> };
const costoReal = (schemas.OrdenListItem as Nodo & { properties: Record<string, Nodo> }).properties.costoReal;

describe("466/R16 — las descripciones del escenario devuelto y del costo congelado", () => {
  it("el flete y su IVA se llaman «Flete por devolución a origen» e «IVA del flete por devolución a origen»", () => {
    expect(String(devuelto.properties.flete.description).startsWith("Flete por devolución a origen. ")).toBe(true);
    expect(String(devuelto.properties.iva.description).startsWith("IVA del flete por devolución a origen. ")).toBe(true);
  });

  it("el resultado se nombra por su codigo vigente, no como «RECHAZADA»", () => {
    const textos = [
      String(devuelto.description),
      String(devuelto.properties.flete.description),
      String(devuelto.properties.iva.description),
      [costoReal.description].flat().join("\n"),
    ];
    for (const t of textos) {
      expect(t).not.toMatch(/RECHAZADA/);
      expect(t).not.toMatch(/flete\s+por\s+rechazo/i);
    }
    expect(String(devuelto.description)).toContain(
      "al cerrarse la orden en Devolución a origen por rechazo (`devolucion_a_origen_por_rechazo`)",
    );
    expect([costoReal.description].flat().join(" ").replace(/\s+/g, " ")).toContain("flete por devolución a origen y su IVA");
  });

  it("el espejo `.yaml` dice exactamente lo mismo (R16, D5)", () => {
    expect(YAML).toContain(`description: ${JSON.stringify(String(devuelto.properties.flete.description))}`);
    expect(YAML).toContain(`description: ${JSON.stringify(String(devuelto.properties.iva.description))}`);
    expect(YAML).toContain(`description: ${JSON.stringify(String(devuelto.description))}`);
    expect(YAML).toContain("por rechazo (`devolucion_a_origen_por_rechazo`), lo que se te factura es el flete por\n");
    expect(YAML).not.toMatch(/RECHAZADA|flete por rechazo/i);
  });
});

describe("466/R17 — el contrato NO cambia de forma", () => {
  it("el escenario devuelto conserva sus cinco campos, su `required` y sus tipos", () => {
    expect(devuelto.required).toEqual(["flete", "iva", "comision", "fulfillment", "total"]);
    expect(Object.keys(devuelto.properties)).toEqual(["flete", "iva", "comision", "fulfillment", "total"]);
    for (const p of Object.values(devuelto.properties)) expect(p.type).toBe("string");
  });

  it("los ids de metrica `rechazos` y `tasa_rechazo` siguen publicados con ese id", () => {
    expect(METRICAS_API_KEY).toContain("rechazos");
    expect(METRICAS_API_KEY).toContain("tasa_rechazo");
    expect(YAML).toMatch(/- rechazos\b/);
    expect(YAML).toMatch(/- tasa_rechazo\b/);
  });
});

describe("466/R18 — el manual de metricas por mensajero", () => {
  it("llama al flete de una devolucion a origen «flete por devolución a origen y su IVA»", () => {
    const manual = leer("docs/api/manual-metricas-por-mensajero.md");
    expect(manual).toContain("**flete por devolución a origen y su IVA**");
    expect(manual).not.toMatch(/flete de devoluci[oó]n y su IVA/);
  });
});

describe("466/R9 — la guia de integracion (HTML) nombra el resultado por su nombre vigente", () => {
  const GUIA = leer("docs/api/guia-integracion/guia-integracion.html");

  it("la nota del `costoReal` dice «termina en Devolución a origen por rechazo», no «termina con rechazo»", () => {
    expect(GUIA).toContain(
      "Si la orden termina en Devolución a origen por rechazo (<code>devolucion_a_origen_por_rechazo</code>), lo que se factura es el escenario <code>devuelto</code> de la cotización, no estos importes.",
    );
    expect(GUIA).not.toMatch(/termina con rechazo/i);
  });
});

describe("466/R19 — la entrada del CHANGELOG", () => {
  const i = CHANGELOG.indexOf("## 2026-10-01 — Sin ruptura — El flete de una devolución a origen");
  const entrada = CHANGELOG.slice(i, CHANGELOG.indexOf("\n## ", i + 1));

  it("existe, esta fechada, va en orden cronologico (mas nueva arriba) y se marca SIN ruptura", () => {
    expect(i).toBeGreaterThan(0);
    // No se exige «la primera»: se romperia con la proxima entrada (review_466 m3). Mismo criterio que
    // changelog-455: por encima solo entradas de fecha posterior o igual, por debajo solo anteriores o iguales.
    const fechas = [...CHANGELOG.matchAll(/^## (\d{4}-\d{2}-\d{2}) /gm)].map((m) => ({ fecha: m[1], en: m.index ?? 0 }));
    expect(fechas.length).toBeGreaterThan(3);
    for (const { fecha, en } of fechas) {
      if (en < i) expect(fecha >= "2026-10-01", `entrada ${fecha} por encima de la 466`).toBe(true);
      if (en > i) expect(fecha <= "2026-10-01", `entrada ${fecha} por debajo de la 466`).toBe(true);
    }
    expect(entrada).toContain("**Sin ruptura.**");
  });

  it("dice que descripciones cambiaron y que ningun campo ni valor cambio", () => {
    expect(entrada).toContain("`CotizacionEscenarioDevuelto.properties.flete`");
    expect(entrada).toContain("`CotizacionEscenarioDevuelto.properties.iva`");
    expect(entrada).toContain("`costoReal`");
    expect(entrada).toContain("Ningún campo, valor");
    expect(entrada).toContain("`rechazos` y `tasa_rechazo`");
  });
});
