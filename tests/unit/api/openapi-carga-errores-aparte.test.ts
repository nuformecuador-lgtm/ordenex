import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// 2026-08-31 — LAS FILAS CON ERROR DE `/carga` SE PUBLICAN APARTE, EN `errores`.
//
// El cambio es de CONTRATO: `filas` pasa a traer solo lo que entro (`creada`/`duplicada`) y lo
// que fallo viaja en una lista hermana. Lo que esta guardia vigila es que los DOS artefactos
// —el objeto TS que sirve `/api/docs/openapi` y su espejo textual `docs/api/api-key-openapi.yaml`—
// lo digan a la vez y digan lo mismo. Un espejo que se quede atras no rompe ningun test de
// runtime: simplemente le enseña al integrador una respuesta que el servidor ya no devuelve.
//
// Los asertos de AUSENCIA valen tanto como los de presencia. Que `CargaRowResult` conserve
// `error` en su enum, o su propiedad `errores`, es exactamente la forma en que este cambio se
// quedaria a medias: el documento seguiria autorizando por escrito la respuesta vieja.
//
// La cotizacion NO entra aqui a proposito: alli cada fila ES la respuesta (su precio), no el
// efecto de haber creado algo, asi que sus filas en `error` siguen dentro de `filas`.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

const PATH_CARGA = "/api/ordenes/api-key/carga";

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
const cargaResponse = schemas.CargaResponse;
const cargaRowResult = schemas.CargaRowResult;
const cargaFilaError = schemas.CargaFilaError;

describe("/carga — `errores` es una lista propia del contrato, en los DOS artefactos", () => {
  it("el objeto TS declara `errores` como propiedad REQUERIDA de la respuesta", () => {
    // Requerida y no opcional: un lote sin fallos devuelve `[]`, nunca la clave ausente. Es lo
    // que permite `if (respuesta.errores.length)` sin comprobar antes si la clave existe.
    expect([...cargaResponse.required]).toContain("errores");
    expect(cargaResponse.properties.errores).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/CargaFilaError" },
    });
  });

  it("el yaml publica la misma clave, requerida y apuntando al mismo schema", () => {
    const bloque = bloqueDeSchema("CargaResponse").map((l) => l.trim());
    expect(bloque).toContain("- errores");
    expect(bloque).toContain('$ref: "#/components/schemas/CargaFilaError"');
  });

  it("`CargaFilaError` exige el detalle: en esa lista no cabe un elemento sin `errores`", () => {
    expect([...cargaFilaError.required].sort()).toEqual(
      ["errores", "fila", "numRemision", "resultado"].sort(),
    );
    expect(cargaFilaError.properties.resultado).toMatchObject({ const: "error" });
    const bloque = bloqueDeSchema("CargaFilaError").map((l) => l.trim());
    expect(bloque).toContain("- errores");
    expect(bloque).toContain("const: error");
  });
});

describe("/carga — `filas` deja de poder contener un error, y el contrato lo dice", () => {
  it("el enum de `CargaRowResult` ya no admite `error`", () => {
    expect([...cargaRowResult.properties.resultado.enum]).toEqual(["creada", "duplicada"]);
    expect(cargaRowResult.properties).not.toHaveProperty("errores");
  });

  it("el yaml de `CargaRowResult` tampoco lo admite", () => {
    const bloque = bloqueDeSchema("CargaRowResult").map((l) => l.trim());
    expect(bloque).toContain("- creada");
    expect(bloque).toContain("- duplicada");
    expect(bloque).not.toContain("- error");
    expect(bloque.some((l) => l.startsWith("errores:"))).toBe(false);
  });

  it("los ejemplos publicados enseñan la fila mala FUERA de `filas`", () => {
    const ejemplos = openApiSpec.paths[PATH_CARGA].post.responses["200"].content[
      "application/json"
    ].examples as Record<
      string,
      {
        value: {
          conError: number;
          filas: ReadonlyArray<{ readonly resultado: string }>;
          errores: ReadonlyArray<{ readonly resultado: string }>;
        };
      }
    >;
    const valores = Object.values(ejemplos);
    expect(valores.length).toBeGreaterThan(0);
    for (const { value } of valores) {
      expect(value.filas.every((f) => f.resultado !== "error")).toBe(true);
      // El contador y la lista no pueden contarse dos historias distintas.
      expect(value.errores).toHaveLength(value.conError);
      expect(value.errores.every((f) => f.resultado === "error")).toBe(true);
    }
  });
});
