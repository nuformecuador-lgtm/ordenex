import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// 2026-08-31 — LAS FILAS SIN PRECIO DE `/cotizacion` SE PUBLICAN APARTE, EN `errores`, Y CADA
// FILA COTIZADA DICE SOBRE QUE MONTO SE COTIZO.
//
// Es el mismo reparto que `/carga` adopto ese dia (ver `openapi-carga-errores-aparte.test.ts`).
// La nota de aquel archivo decia que la cotizacion NO entraba «porque alli cada fila ES la
// respuesta, no el efecto de haber creado algo»; el argumento describia bien la diferencia y
// resolvia mal la pregunta: lo que hace util separar no es que la fila sea un efecto, es que el
// caso a atender no tiene que buscarse dentro del caso normal. Aqui vale igual.
//
// Lo que esta guardia vigila es que los DOS artefactos —el objeto TS que sirve
// `/api/docs/openapi` y su espejo textual `docs/api/api-key-openapi.yaml`— lo digan a la vez y
// digan lo mismo. Un espejo que se quede atras no rompe ningun test de runtime: simplemente le
// enseña al integrador una respuesta que el servidor ya no devuelve.
//
// Los asertos de AUSENCIA valen tanto como los de presencia. Que `CotizacionRowResult` conserve
// `error` en su enum, o su propiedad `errores`, es exactamente la forma en que este cambio se
// quedaria a medias: el documento seguiria autorizando por escrito la respuesta vieja.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

const PATH_COTIZACION = "/api/ordenes/api-key/cotizacion";

/** Sangria (nº de espacios) de una linea; `null` si esta en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Lineas del bloque `    <nombre>:` de `components.schemas`, sin su cabecera. */
function bloqueDeSchema(nombre: string): string[] {
  const inicio = lineasYaml.findIndex((l) => l === `    ${nombre}:`);
  if (inicio === -1) throw new Error(`El yaml no declara el schema ${nombre}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind !== null && ind <= 4) break;
    out.push(lineasYaml[i]);
  }
  return out;
}

const schemas = openApiSpec.components.schemas;
const cotizacionResponse = schemas.CotizacionResponse;
const cotizacionRowResult = schemas.CotizacionRowResult;
const cotizacionFilaError = schemas.CotizacionFilaError;

describe("/cotizacion — `errores` es una lista propia del contrato, en los DOS artefactos", () => {
  it("el objeto TS declara `errores` como propiedad REQUERIDA de la respuesta", () => {
    // Requerida y no opcional: un lote sin fallos devuelve `[]`, nunca la clave ausente. Es lo
    // que permite `if (respuesta.errores.length)` sin comprobar antes si la clave existe.
    expect([...cotizacionResponse.required]).toContain("errores");
    expect(cotizacionResponse.properties.errores).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/CotizacionFilaError" },
    });
  });

  it("el yaml publica la misma clave, requerida y apuntando al mismo schema", () => {
    const bloque = bloqueDeSchema("CotizacionResponse").map((l) => l.trim());
    expect(bloque).toContain("- errores");
    expect(bloque).toContain('$ref: "#/components/schemas/CotizacionFilaError"');
  });

  it("`CotizacionFilaError` exige el detalle: en esa lista no cabe un elemento sin `errores`", () => {
    expect([...cotizacionFilaError.required].sort()).toEqual(
      ["errores", "fila", "numRemision", "resultado"].sort(),
    );
    expect(cotizacionFilaError.properties.resultado).toMatchObject({ const: "error" });
    const bloque = bloqueDeSchema("CotizacionFilaError").map((l) => l.trim());
    expect(bloque).toContain("- errores");
    expect(bloque).toContain("const: error");
  });
});

describe("/cotizacion — `filas` deja de poder contener un error, y el contrato lo dice", () => {
  it("`CotizacionRowResult` ya no admite `error` ni la propiedad `errores`", () => {
    // El enum de dos valores se convierte en la constante `cotizada`: en esta lista ya no hay
    // dos clasificaciones que distinguir.
    expect(cotizacionRowResult.properties.resultado).toMatchObject({ const: "cotizada" });
    expect(cotizacionRowResult.properties).not.toHaveProperty("errores");
    // Y `costos` deja de ser opcional: una fila sin precio no esta aqui.
    expect([...cotizacionRowResult.required]).toContain("costos");
  });

  it("el yaml de `CotizacionRowResult` dice lo mismo", () => {
    const bloque = bloqueDeSchema("CotizacionRowResult").map((l) => l.trim());
    expect(bloque).toContain("const: cotizada");
    expect(bloque).not.toContain("- error");
    expect(bloque.some((l) => l.startsWith("errores:"))).toBe(false);
    expect(bloque).toContain("- costos");
  });

  it("el ejemplo publicado enseña la fila mala FUERA de `filas`", () => {
    const ejemplos = openApiSpec.paths[PATH_COTIZACION].post.responses["200"].content[
      "application/json"
    ].examples as Record<
      string,
      {
        value: {
          cotizadas: number;
          conError: number;
          filas: ReadonlyArray<{ readonly resultado: string }>;
          errores: ReadonlyArray<{ readonly resultado: string }>;
        };
      }
    >;
    const valores = Object.values(ejemplos);
    expect(valores.length).toBeGreaterThan(0);
    for (const { value } of valores) {
      expect(value.filas.every((f) => f.resultado === "cotizada")).toBe(true);
      // Los contadores y las listas no pueden contarse dos historias distintas.
      expect(value.filas).toHaveLength(value.cotizadas);
      expect(value.errores).toHaveLength(value.conError);
      expect(value.errores.every((f) => f.resultado === "error")).toBe(true);
    }
  });
});

describe("/cotizacion — la fila cotizada publica el valor sobre el que se cotizo", () => {
  it("`montoCobrar` es una propiedad REQUERIDA de la fila con precio", () => {
    // Requerida porque el resto de la fila se DERIVA de el: un desglose sin su base obliga al
    // integrador a suponer sobre que numero se calculo, y la cotizacion redondea al colon.
    expect([...cotizacionRowResult.required]).toContain("montoCobrar");
    expect(cotizacionRowResult.properties.montoCobrar).toMatchObject({ type: "string" });
  });

  it("el yaml publica la misma propiedad, requerida y como string", () => {
    const bloque = bloqueDeSchema("CotizacionRowResult").map((l) => l.trim());
    expect(bloque).toContain("- montoCobrar");
    expect(bloque).toContain("montoCobrar:");
  });

  it("el ejemplo publicado lo enseña en el mismo dialecto crudo que los importes", () => {
    const ejemplos = openApiSpec.paths[PATH_COTIZACION].post.responses["200"].content[
      "application/json"
    ].examples as Record<string, { value: { filas: ReadonlyArray<{ montoCobrar: string }> } }>;
    for (const { value } of Object.values(ejemplos)) {
      for (const f of value.filas) {
        expect(f.montoCobrar).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
    // El espejo enseña el mismo valor: si uno lo publica y el otro no, uno miente.
    expect(yaml).toContain('montoCobrar: "25900.00"');
  });
});
