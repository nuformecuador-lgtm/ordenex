import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// Feature 177 (R41, R45) — contrato publicado del canal por API key tras la alta de los tres
// endpoints nuevos (consulta por guía/remisión y PDF de etiqueta por orden y por lote) y la
// publicación de `cargaId` en `CargaResponse`.
//
// El `.yaml` es un archivo de texto: nada más lo mantiene sincronizado con el objeto TS, así que
// cada afirmación se hace sobre AMBOS artefactos. Los guards hermanos
// (`openapi-contrato-en-reparto.test.ts`, `openapi-carga-row-paridad.test.ts`) cubren los enums de
// estado y `CargaRow`; este cubre los paths y `CargaResponse`.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

/** Sangría (nº de espacios) de una línea; `null` si está en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Líneas del bloque `    <nombre>:` de `components.schemas`, sin su cabecera. */
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

/** Líneas de una clave anidada del bloque (p. ej. `properties:` a sangría 6). */
function subBloque(bloque: string[], clave: string, sangria: number): string[] {
  const inicio = bloque.findIndex((l) => l === `${" ".repeat(sangria)}${clave}:`);
  if (inicio === -1) throw new Error(`El bloque no declara ${clave}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < bloque.length; i++) {
    const ind = indent(bloque[i]);
    if (ind !== null && ind <= sangria) break;
    out.push(bloque[i]);
  }
  return out;
}

/** Claves de `paths:` del yaml (líneas `  "/api/...":`), en orden de declaración. */
function pathsDelYaml(): string[] {
  const inicio = lineasYaml.findIndex((l) => l === "paths:");
  if (inicio === -1) throw new Error("El yaml no declara `paths:`");
  const out: string[] = [];
  for (let i = inicio + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind === 0) break;
    const m = /^ {2}"([^"]+)":\s*$/.exec(lineasYaml[i]);
    if (m) out.push(m[1]);
  }
  return out;
}

const PATH_DETALLE_POR_ID = "/api/ordenes/api-key/orden/{id}";
const PATH_PDF_ORDEN = "/api/ordenes/api-key/orden/{id}/generate";
const PATH_PDF_CARGA = "/api/ordenes/api-key/carga/{cargaId}/generate";

/** Los 7 endpoints que el canal por API key publica tras la feature 177. */
const PATHS_ESPERADOS = [
  "/api/ordenes/api-key/carga",
  "/api/ordenes/api-key",
  "/api/ordenes/api-key/{numGuia}",
  "/api/ordenes/api-key/{numGuia}/cancelar",
  PATH_DETALLE_POR_ID,
  PATH_PDF_ORDEN,
  PATH_PDF_CARGA,
];

describe("177/R41 — el OpenAPI publica los siete endpoints del canal por API key", () => {
  const clavesTs = Object.keys(openApiSpec.paths);

  it("el objeto TS declara exactamente siete paths, uno por endpoint, y ninguno más", () => {
    expect(clavesTs).toHaveLength(7);
    expect(clavesTs).toEqual(PATHS_ESPERADOS);
  });

  it("los tres endpoints nuevos aparecen nombrados uno a uno en el objeto TS", () => {
    expect(clavesTs).toContain(PATH_DETALLE_POR_ID);
    expect(clavesTs).toContain(PATH_PDF_ORDEN);
    expect(clavesTs).toContain(PATH_PDF_CARGA);
  });

  it("el .yaml publicado declara los mismos siete paths, en el mismo orden", () => {
    expect(pathsDelYaml()).toEqual(PATHS_ESPERADOS);
  });

  it("la consulta por identificador es GET y reutiliza el schema OrdenDetalle de la 106", () => {
    const operacion = openApiSpec.paths[PATH_DETALLE_POR_ID];
    expect(Object.keys(operacion)).toEqual(["parameters", "get"]);
    expect(operacion.get.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/OrdenDetalle",
    });
  });

  it("los dos endpoints de PDF son solo POST y devuelven PdfGenerateResponse", () => {
    for (const clave of [PATH_PDF_ORDEN, PATH_PDF_CARGA] as const) {
      const operacion = openApiSpec.paths[clave];
      expect(Object.keys(operacion)).toEqual(["parameters", "post"]);
      expect(operacion.post.responses["200"].content["application/json"].schema).toEqual({
        $ref: "#/components/schemas/PdfGenerateResponse",
      });
    }
  });

  it("el schema PdfGenerateResponse publica url, expiraEnSegundos y generado como requeridos", () => {
    const schema = openApiSpec.components.schemas.PdfGenerateResponse;
    expect(Object.keys(schema.properties)).toEqual(["url", "expiraEnSegundos", "generado"]);
    expect([...schema.required]).toEqual(["url", "expiraEnSegundos", "generado"]);
    expect(schema.properties.url.type).toBe("string");
    expect(schema.properties.expiraEnSegundos.type).toBe("integer");
    expect(schema.properties.generado.type).toBe("boolean");
  });

  it("el .yaml declara PdfGenerateResponse con las mismas propiedades requeridas", () => {
    const bloque = bloqueDeSchema("PdfGenerateResponse");
    const requeridas = subBloque(bloque, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridas).toEqual(["url", "expiraEnSegundos", "generado"]);
    const propiedades = subBloque(bloque, "properties", 6)
      .filter((l) => indent(l) === 8)
      .map((l) => l.trim().replace(/:$/, ""));
    expect(propiedades).toEqual(["url", "expiraEnSegundos", "generado"]);
  });

  it("los tres endpoints nuevos reutilizan las responses de error existentes por $ref", () => {
    const nombreDeResponse: Record<string, string> = {
      "401": "Unauthorized",
      "403": "Forbidden",
      "404": "NotFound",
      "409": "Conflict",
      "422": "ValidationError",
    };
    const casos: Array<{ responses: Record<string, unknown>; codigos: string[] }> = [
      {
        responses: openApiSpec.paths[PATH_DETALLE_POR_ID].get.responses,
        codigos: ["401", "403", "404", "422"],
      },
      {
        responses: openApiSpec.paths[PATH_PDF_ORDEN].post.responses,
        codigos: ["401", "403", "404", "409", "422"],
      },
      {
        responses: openApiSpec.paths[PATH_PDF_CARGA].post.responses,
        codigos: ["401", "403", "404", "409", "422"],
      },
    ];
    for (const { responses: operacionResponses, codigos } of casos) {
      const operacion = { responses: operacionResponses };
      expect(Object.keys(operacion.responses)).toEqual(["200", ...codigos]);
      for (const codigo of codigos) {
        expect(operacion.responses[codigo]).toEqual({
          $ref: `#/components/responses/${nombreDeResponse[codigo]}`,
        });
      }
    }
  });
});

describe("177/R45 — CargaResponse publica el cargaId que exige el endpoint de PDF por lote", () => {
  const cargaResponse = openApiSpec.components.schemas.CargaResponse;

  it("el objeto TS declara cargaId como uuid nullable y NO lo exige en required", () => {
    const cargaId = cargaResponse.properties.cargaId;
    expect(cargaId).toBeDefined();
    expect([...cargaId.type]).toEqual(["string", "null"]);
    expect(cargaId.format).toBe("uuid");
    expect([...cargaResponse.required]).not.toContain("cargaId");
  });

  it("el .yaml declara cargaId igual que el objeto TS (string|null, format uuid, no required)", () => {
    const bloque = bloqueDeSchema("CargaResponse");
    const propiedades = subBloque(bloque, "properties", 6);
    const lineas = subBloque(propiedades, "cargaId", 8).map((l) => l.trim());
    expect(lineas).toContain("type:");
    expect(lineas).toContain("- string");
    expect(lineas).toContain('- "null"');
    expect(lineas).toContain("format: uuid");
    const requeridas = subBloque(bloque, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridas).not.toContain("cargaId");
    expect(requeridas).toEqual([...cargaResponse.required]);
  });

  it("el ejemplo publicado de POST /api/ordenes/api-key/carga muestra el cargaId", () => {
    const ejemplo =
      openApiSpec.paths["/api/ordenes/api-key/carga"].post.responses["200"].content[
        "application/json"
      ].examples.resumen.value;
    expect(ejemplo).toHaveProperty("cargaId");
    expect(typeof ejemplo.cargaId).toBe("string");
    expect(ejemplo.cargaId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // El .yaml publica el MISMO valor de ejemplo: si uno cambia, el otro miente.
    expect(yaml).toContain(`cargaId: "${ejemplo.cargaId}"`);
  });
});
