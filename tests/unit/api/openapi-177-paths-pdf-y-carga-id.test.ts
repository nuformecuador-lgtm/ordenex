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

// ALTA de la feature 255 (R47) — el OCTAVO endpoint del canal. Esta lista estaba firmada en
// SIETE desde la 177 y publicar la cotización la puso ROJA: ESE es su trabajo. Sube a OCHO A
// PROPÓSITO, en el mismo commit que publica el endpoint, y no de contrabando. Qué se añadió y
// por qué: `POST /api/ordenes/api-key/cotizacion` es un borde de LECTURA PURA —cotiza el precio
// y la cobertura de un lote sin crear órdenes, sin consumir guías y sin persistir nada—, y se
// publica en el canal por API key porque lo consume el mismo integrador, con la misma key y con
// el mismo cuerpo que manda a `/carga`. Un endpoint que sirve precios y no está en el contrato
// publicado es un precio sin contrato: por eso el alta va aquí y en el `.yaml` a la vez.
const PATH_COTIZACION = "/api/ordenes/api-key/cotizacion";

// ALTA de la feature 266 (R28) — el NOVENO endpoint del canal, y el alta se hace con la misma
// regla que la de la 255: la lista estaba firmada en OCHO, publicar la habilitación la puso ROJA,
// y sube a NUEVE A PROPÓSITO en el MISMO commit que publica el endpoint. Qué se añadió y por qué:
// `POST /api/ordenes/api-key/habilitar` habilita en lote pedidos con novedad —el integrador manda
// `{ num_guia, nota }` y recibe, fila por fila, si la orden volvió a `en_reparto` o si solo quedó
// registrada la habilitación—. Es un borde de ESCRITURA del mismo canal, con la misma key, así
// que un integrador que no lo encuentre en el contrato publicado no puede usarlo.
const PATH_HABILITAR = "/api/ordenes/api-key/habilitar";

/** Los 9 endpoints que el canal por API key publica tras la 177, la 255 y la 266. */
const PATHS_ESPERADOS = [
  "/api/ordenes/api-key/carga",
  "/api/ordenes/api-key",
  "/api/ordenes/api-key/{numGuia}",
  "/api/ordenes/api-key/{numGuia}/cancelar",
  PATH_DETALLE_POR_ID,
  PATH_PDF_ORDEN,
  PATH_PDF_CARGA,
  PATH_COTIZACION,
  PATH_HABILITAR,
];

describe("177/R41 + 255/R47 + 266/R28 — el OpenAPI publica los nueve endpoints del canal", () => {
  const clavesTs = Object.keys(openApiSpec.paths);

  it("el objeto TS declara exactamente nueve paths, uno por endpoint, y ninguno más", () => {
    expect(clavesTs).toHaveLength(9);
    expect(clavesTs).toEqual(PATHS_ESPERADOS);
  });

  it("los tres endpoints nuevos aparecen nombrados uno a uno en el objeto TS", () => {
    expect(clavesTs).toContain(PATH_DETALLE_POR_ID);
    expect(clavesTs).toContain(PATH_PDF_ORDEN);
    expect(clavesTs).toContain(PATH_PDF_CARGA);
  });

  it("el .yaml publicado declara los mismos nueve paths, en el mismo orden", () => {
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Feature 255 — el borde de cotización, publicado. Dos afirmaciones y solo dos en este archivo:
// que el canal declara OCHO endpoints en los DOS artefactos (R47) y que la descripción publicada
// del octavo declara el supuesto de comisión (R29). El resto del contrato de la cotización lo
// cubren sus propias suites; aquí vive lo que esta guardia ya congelaba: la lista de paths.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("255/R47 + 266/R28 — el canal publica NUEVE endpoints, en el objeto TS y en el .yaml", () => {
  it("los dos artefactos declaran nueve paths, el mismo octavo y el mismo noveno, en su posición", () => {
    const clavesTs = Object.keys(openApiSpec.paths);
    const clavesYaml = pathsDelYaml();
    expect(clavesTs).toHaveLength(9);
    expect(clavesYaml).toHaveLength(9);
    expect(clavesTs[7]).toBe(PATH_COTIZACION);
    expect(clavesYaml[7]).toBe(PATH_COTIZACION);
    expect(clavesTs[8]).toBe(PATH_HABILITAR);
    expect(clavesYaml[8]).toBe(PATH_HABILITAR);
    // Espejo exacto: el .yaml es un archivo de texto y nada más lo mantiene sincronizado.
    expect(clavesYaml).toEqual(clavesTs);
  });

  it("el octavo endpoint es POST y devuelve CotizacionResponse", () => {
    const operacion = openApiSpec.paths[PATH_COTIZACION];
    expect(Object.keys(operacion)).toEqual(["post"]);
    expect(operacion.post.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/CotizacionResponse",
    });
  });
});

describe("255/R29 — la descripción del endpoint declara el supuesto", () => {
  const descripcion: string = openApiSpec.paths[PATH_COTIZACION].post.description;

  it("la descripción publicada menciona el supuesto `cobra_comision = true`", () => {
    // El supuesto NO viaja como campo del cuerpo (se descartó `supuestos.cobraComision`): el
    // sitio donde un integrador busca los supuestos de un precio es el contrato publicado. Si
    // esta línea desaparece, el precio pasa a afirmar una comisión que nadie declaró.
    expect(descripcion).toContain("cobra_comision = true");
    expect(descripcion).toMatch(/comisi[oó]n COD/i);
  });

  it("el .yaml publica el MISMO supuesto: si uno lo dice y el otro no, uno miente", () => {
    expect(yaml).toContain("cobra_comision = true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Feature 255 (R21) — CotizacionRow NO promete un rechazo que el servidor no hace.
//
// El borde valida el cuerpo GRUESO (`ordenes: array de records de texto`, 1..tope) y aplica
// `filaCotizacionSchema` FILA A FILA dentro del service: una fila sin `provincia` NO tumba el
// lote, sale 200 con esa fila en `resultado: "error"` y las demás se cotizan igual. Declarar la
// terna en `required` haría que un cliente generado con validación estricta rechazara EN LOCAL
// un cuerpo que el servidor acepta y responde 200. El que manda es el código: el documento
// describe lo que el borde hace, no al revés.
//
// Ojo con la asimetría: esto vale para el schema de ENTRADA. En los schemas de RESPUESTA
// (`CotizacionEscenarioEntregado/Devuelto`, `CotizacionCostos`, `CotizacionRowResult`,
// `CotizacionTotales`, `CotizacionResponse`) `required` SÍ es una promesa que el servidor
// cumple siempre (R26/R27/R28/R52/R54) y quitarlo debilitaría el contrato.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("255/R21 — CotizacionRow no declara `required`: una fila incompleta no es un 422", () => {
  const cotizacionRow: Record<string, unknown> = openApiSpec.components.schemas.CotizacionRow;

  it("el objeto TS no declara `required` en el schema de entrada por fila", () => {
    expect(Object.keys(cotizacionRow)).not.toContain("required");
    expect(Object.keys(cotizacionRow.properties as object)).toEqual([
      "provincia",
      "canton",
      "distrito",
      "direccion",
      "monto_cobrar",
      "num_remision",
    ]);
  });

  it("el .yaml tampoco lo declara: el espejo dice lo mismo", () => {
    const bloque = bloqueDeSchema("CotizacionRow");
    expect(bloque.filter((l) => l === "      required:")).toEqual([]);
  });

  it("la descripción explica cuándo es 422 del lote y cuándo es 200 con la fila en error", () => {
    const descripcion = String(cotizacionRow.description);
    for (const texto of [descripcion, yaml]) {
      expect(texto).toMatch(/NO es un 422 del lote/);
      expect(texto).toMatch(/resultado: ("|\\")error("|\\")/);
      expect(texto).toMatch(/éxito parcial/i);
    }
  });

  it("los schemas de RESPUESTA conservan su `required`: ahí sí es una promesa cumplida", () => {
    const schemas = openApiSpec.components.schemas;
    expect([...schemas.CotizacionEscenarioEntregado.required]).toEqual([
      "flete",
      "iva",
      "comision",
      "ivaComision",
      "total",
    ]);
    expect([...schemas.CotizacionEscenarioDevuelto.required]).toEqual([
      "flete",
      "iva",
      "comision",
      "total",
    ]);
    expect([...schemas.CotizacionCostos.required]).toEqual(["entregado", "devuelto"]);
    expect([...schemas.CotizacionRowResult.required]).toEqual([
      "fila",
      "numRemision",
      "resultado",
    ]);
    expect([...schemas.CotizacionTotales.required]).toEqual([
      "filasSumadas",
      "filasExcluidas",
      "entregado",
      "devuelto",
    ]);
    expect([...schemas.CotizacionResponse.required]).toEqual([
      "total",
      "cotizadas",
      "conError",
      "totales",
      "filas",
    ]);
  });
});
