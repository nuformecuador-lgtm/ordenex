import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { METRICAS_API_KEY, METRICAS_TODAS } from "@/lib/analytics/publicacion-api-key";
import { METRICAS } from "@/lib/analytics/metrics";

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

// ALTA de la feature 267 (R39) — el NOVENO endpoint del canal. La lista estaba firmada en OCHO
// desde la 255 y publicar la analítica la puso ROJA: ESE es su trabajo, y por eso sube aquí, en
// el mismo commit que publica el endpoint y en los dos artefactos. Qué se añadió:
// `GET /api/ordenes/api-key/analitica` sirve una serie diaria de UNA métrica sobre las órdenes de
// la tienda dueña de la key. Es el primer endpoint del canal que no habla de órdenes concretas
// sino de cifras agregadas, y publicarlo obligó a revertir una decisión firmada (122/R11–D9,
// «`apiKey` denegado POR DISEÑO») y a estrechar dos guardias de frontera a una allowlist nominal.
// Un endpoint que sirve cifras y no está en el contrato publicado es una cifra sin contrato.
const PATH_ANALITICA = "/api/ordenes/api-key/analitica";

// ALTA de la feature 266 (R28) — el DECIMO endpoint del canal, y el alta se hace con la misma
// regla que la de la 255 y la 267: la lista estaba firmada en NUEVE, publicar la habilitación la
// puso ROJA, y sube a DIEZ A PROPÓSITO en el MISMO commit que publica el endpoint. Qué se añadió
// y por qué: `POST /api/ordenes/api-key/habilitar` habilita en lote pedidos con novedad —el
// integrador manda `{ num_guia, nota }` y recibe, fila por fila, si la orden volvió a
// `en_reparto` o si solo quedó registrada la habilitación—. Es un borde de ESCRITURA del mismo
// canal, con la misma key, así que un integrador que no lo encuentre en el contrato publicado no
// puede usarlo.
const PATH_HABILITAR = "/api/ordenes/api-key/habilitar";

// ⚠️ FICHA 322 (2026-08-28) — LO QUE ESTA LISTA NO PUEDE VER, Y QUIÉN LO VE AHORA.
//
// Esta lista es el contrato PUBLICADO, escrito y firmado a mano, y ése es justo su valor: subir de
// diez a once obliga a un humano a escribir el alta y su porqué en el mismo commit (la 255, la 267
// y la 266 lo hicieron aquí arriba). Lo que NO puede hacer —porque compara el objeto TS contra sí
// mismo y contra su copia en `.yaml`, nunca contra el filesystem— es enterarse de que existe un
// `app/api/ordenes/api-key/**/route.ts` que nadie documentó: eso deja el gate ENTERO en verde. Se
// midió el 2026-08-28: con una ruta nueva sin documentar en el canal, los 13 archivos y 223 tests
// de `tests/unit/api/` pasaron los 223.
//
// Ese hueco lo cubre ahora `tests/unit/guards/openapi-canal-rutas-reales.guardia.test.ts`, que lee
// las rutas REALES del filesystem y compara OPERACIONES (verbo + path) en las dos direcciones. Las
// dos se necesitan y NINGUNA sustituye a la otra: sin esta lista se pierde la firma humana del
// contrato; sin la guardia vuelve el agujero de la 322. No borres una alegando la otra.
/** Los 10 endpoints que el canal por API key publica tras la 177, la 255, la 267 y la 266. */
const PATHS_ESPERADOS = [
  "/api/ordenes/api-key/carga",
  "/api/ordenes/api-key",
  "/api/ordenes/api-key/{numGuia}",
  "/api/ordenes/api-key/{numGuia}/cancelar",
  PATH_DETALLE_POR_ID,
  PATH_PDF_ORDEN,
  PATH_PDF_CARGA,
  PATH_COTIZACION,
  PATH_ANALITICA,
  PATH_HABILITAR,
];

describe("177/R41 + 255/R47 + 267/R39 + 266/R28 — el OpenAPI publica los diez endpoints del canal", () => {
  const clavesTs = Object.keys(openApiSpec.paths);

  it("el objeto TS declara exactamente diez paths, uno por endpoint, y ninguno más", () => {
    expect(clavesTs).toHaveLength(10);
    expect(clavesTs).toEqual(PATHS_ESPERADOS);
  });

  it("los tres endpoints nuevos aparecen nombrados uno a uno en el objeto TS", () => {
    expect(clavesTs).toContain(PATH_DETALLE_POR_ID);
    expect(clavesTs).toContain(PATH_PDF_ORDEN);
    expect(clavesTs).toContain(PATH_PDF_CARGA);
  });

  it("el .yaml publicado declara los mismos diez paths, en el mismo orden", () => {
    expect(pathsDelYaml()).toEqual(PATHS_ESPERADOS);
  });

  // ALTA de la FICHA 320 (2026-08-28) — el path de la orden por identificador gana un SEGUNDO
  // verbo. El censo de PATHS no sube (sigue en diez): el borrado NO estrena ruta, estrena
  // `DELETE` sobre la que ya existe, porque retira EXACTAMENTE el recurso que esa ruta
  // identifica. Esta lista estaba firmada en `["parameters", "get"]` y publicar el borrado la
  // puso ROJA: ESE es su trabajo, y sube a tres A PROPOSITO, en el mismo commit que publica el
  // endpoint. El contenido del `delete` (schema, codigos, los dos artefactos) se afirma en
  // `openapi-320-eliminar.test.ts`, igual que la 266 hizo con el suyo.
  it("la consulta por identificador es GET, comparte path con el DELETE de la 320 y reutiliza OrdenDetalle", () => {
    const operacion = openApiSpec.paths[PATH_DETALLE_POR_ID];
    expect(Object.keys(operacion)).toEqual(["parameters", "get", "delete"]);
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

  // `generado` se RETIRO del contrato el 2026-08-25. La asercion es de igualdad exacta
  // (`toEqual`, no `toContain`) a proposito: asi el dia que alguien lo reintroduzca "porque es
  // aditivo" el test se pone rojo, en vez de dejar volver un campo que ya se decidio no publicar.
  it("el schema PdfGenerateResponse publica SOLO url y expiraEnSegundos como requeridos", () => {
    const schema = openApiSpec.components.schemas.PdfGenerateResponse;
    expect(Object.keys(schema.properties)).toEqual(["url", "expiraEnSegundos"]);
    expect([...schema.required]).toEqual(["url", "expiraEnSegundos"]);
    expect(schema.properties.url.type).toBe("string");
    expect(schema.properties.expiraEnSegundos.type).toBe("integer");
  });

  it("el .yaml declara PdfGenerateResponse con las mismas propiedades requeridas", () => {
    const bloque = bloqueDeSchema("PdfGenerateResponse");
    const requeridas = subBloque(bloque, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridas).toEqual(["url", "expiraEnSegundos"]);
    const propiedades = subBloque(bloque, "properties", 6)
      .filter((l) => indent(l) === 8)
      .map((l) => l.trim().replace(/:$/, ""));
    expect(propiedades).toEqual(["url", "expiraEnSegundos"]);
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
describe("255/R47 — el octavo endpoint del canal sigue en su sitio, en el objeto TS y en el .yaml", () => {
  it("los dos artefactos declaran el mismo octavo path, en la misma posición", () => {
    const clavesTs = Object.keys(openApiSpec.paths);
    const clavesYaml = pathsDelYaml();
    expect(clavesTs[7]).toBe(PATH_COTIZACION);
    expect(clavesYaml[7]).toBe(PATH_COTIZACION);
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
    // `fulfillment` (2026-08-25) es el sexto concepto del entregado y el quinto del devuelto:
    // se cobra tambien cuando el paquete vuelve, porque el servicio de bodega ya se presto.
    expect([...schemas.CotizacionEscenarioEntregado.required]).toEqual([
      "flete",
      "iva",
      "comision",
      "ivaComision",
      "fulfillment",
      "total",
    ]);
    expect([...schemas.CotizacionEscenarioDevuelto.required]).toEqual([
      "flete",
      "iva",
      "comision",
      "fulfillment",
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Feature 267 (R39) — la analítica por API key, publicada. El canal pasa de OCHO a NUEVE
// endpoints, y la afirmación se hace sobre los DOS artefactos: el objeto TS y el `.yaml`, en el
// mismo orden y en la misma posición. El `.yaml` es un archivo de texto y nada más lo mantiene
// sincronizado; un endpoint que existe y no está publicado es un contrato que solo conoce quien
// leyó el código.
// ─────────────────────────────────────────────────────────────────────────────────────────────
/** Forma de un `parameter` de OpenAPI, lo justo para asertar sobre el sin castear en cada línea. */
interface ParametroOpenApi {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly description: string;
  readonly schema: Record<string, unknown>;
}

function parametrosDeAnalitica(): readonly ParametroOpenApi[] {
  return openApiSpec.paths[PATH_ANALITICA].get.parameters as readonly ParametroOpenApi[];
}

/**
 * La prosa del endpoint de analítica TAL COMO SE PUBLICA en el `.yaml` (bloque `description: |-`
 * hasta `parameters:`). Se extrae del texto, no del objeto TS: el `.yaml` es un archivo aparte y
 * nada más que este tipo de aserto lo mantiene diciendo lo mismo.
 */
function descripcionDeAnaliticaEnYaml(): string {
  const inicio = lineasYaml.findIndex((l) => l === `  "${PATH_ANALITICA}":`);
  if (inicio < 0) throw new Error("el .yaml no publica el path de analitica");
  const desc = lineasYaml.findIndex((l, i) => i > inicio && l.trim() === "description: |-");
  if (desc < 0) throw new Error("el path de analitica no tiene bloque `description` en el .yaml");
  const fin = lineasYaml.findIndex((l, i) => i > desc && l === "      parameters:");
  if (fin < 0) throw new Error("no se encontro el final de la descripcion de analitica");
  return lineasYaml.slice(desc + 1, fin).join("\n");
}

/** Lanza si el parámetro no existe: un `undefined` silencioso volvería verde este guard. */
function parametroDeAnalitica(nombre: string): ParametroOpenApi {
  const p = parametrosDeAnalitica().find((x) => x.name === nombre);
  if (!p) throw new Error(`el path de analitica no declara el parametro ${nombre}`);
  return p;
}

describe("267/R39 — la analítica es el NOVENO endpoint del canal, en el objeto TS y en el .yaml", () => {
  it("los dos artefactos declaran el mismo noveno path, en la misma posición", () => {
    const clavesTs = Object.keys(openApiSpec.paths);
    const clavesYaml = pathsDelYaml();
    expect(clavesTs[8]).toBe(PATH_ANALITICA);
    expect(clavesYaml[8]).toBe(PATH_ANALITICA);
    expect(clavesYaml).toEqual(clavesTs);
  });

  it("el noveno endpoint es GET y devuelve AnaliticaRespuesta (el SOBRE del lote)", () => {
    const operacion = openApiSpec.paths[PATH_ANALITICA];
    expect(Object.keys(operacion)).toEqual(["get"]);
    // P4-bis: la unidad publicada es el sobre, no la serie suelta. Si esto volviera a apuntar a
    // `AnaliticaSerie`, el contrato prometeria una forma que el endpoint ya no devuelve.
    expect(operacion.get.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/AnaliticaRespuesta",
    });
    // 401/403/422 por `$ref` a las responses que el canal ya declara: una shape de error propia
    // para este endpoint sería una segunda forma de decir «no» en el mismo contrato.
    expect(Object.keys(operacion.get.responses)).toEqual(["200", "401", "403", "422"]);
    for (const [codigo, nombre] of [
      ["401", "Unauthorized"],
      ["403", "Forbidden"],
      ["422", "ValidationError"],
    ] as const) {
      expect(operacion.get.responses[codigo]).toEqual({
        $ref: `#/components/responses/${nombre}`,
      });
    }
  });

  it("el enum de `metricas` SE DERIVA de la lista blanca más el centinela `all`", () => {
    // Si el enum se hubiera copiado a mano, un alta o una baja en `METRICAS_API_KEY` dejaría el
    // contrato publicado prometiendo métricas que el endpoint no concede (o callando las que
    // sí). Se compara contra la fuente, no contra una lista repetida en este test. `all` va al
    // final y desde la MISMA fuente (P4-bis): el centinela y la lista que expande se declaran
    // juntos o acaban divergiendo.
    const metricas = parametroDeAnalitica("metricas");
    expect(metricas.required).toBe(true);
    expect([...((metricas.schema as { enum?: readonly string[] }).enum ?? [])]).toEqual([
      ...METRICAS_API_KEY,
      METRICAS_TODAS,
    ]);

    // Y el `.yaml` publica los MISMOS ids, en el MISMO orden: si uno cambia, el otro miente.
    const inicio = lineasYaml.findIndex((l) => l === "        - name: metricas");
    expect(inicio).toBeGreaterThan(-1);
    const idsYaml: string[] = [];
    for (let i = inicio; i < lineasYaml.length; i++) {
      const m = /^ {14}- ([a-z_]+)$/.exec(lineasYaml[i]);
      if (m) idsYaml.push(m[1]);
      else if (idsYaml.length > 0) break;
    }
    expect(idsYaml).toEqual([...METRICAS_API_KEY, METRICAS_TODAS]);
  });

  it("`desde` y `hasta` son OBLIGATORIOS y se publican como fecha calendario inclusiva", () => {
    // Decisión P3 de la puerta (2026-08-23): los mismos nombres y la misma semántica que publicó
    // la 257 en el listado. Un canal con dos convenciones de fecha es una trampa para el
    // integrador, y un rango con default haría que dos llamadas idénticas devolvieran conjuntos
    // distintos según cuándo se llamó.
    for (const nombre of ["desde", "hasta"] as const) {
      const p = parametroDeAnalitica(nombre);
      expect(p.required).toBe(true);
      expect(p.in).toBe("query");
      expect(p.schema).toEqual({ type: "string", format: "date" });
    }
    const hasta = parametroDeAnalitica("hasta");
    expect(hasta.description).toContain("INCLUSIVA");
    expect(hasta.description).toContain("366");
    // Y no se publican presets: el vocabulario interno de rangos no cruza al contrato público.
    expect(parametrosDeAnalitica().map((p) => p.name)).toEqual(["metricas", "desde", "hasta"]);
  });

  it("el schema AnaliticaSerie publica TRES campos —metrica, unidad, data— en el TS y en el .yaml", () => {
    // ENMIENDA 2026-08-24. Aquí se exigía `unidadDeConteo`, `puntos` y `cobertura`, y ya no:
    //  - `puntos` se llama `data`;
    //  - `unidadDeConteo` es un hecho del CATÁLOGO, no de cada respuesta: viaja una vez en la
    //    descripción del endpoint (ver el test de abajo), no en cada payload;
    //  - `cobertura` salió entera porque su información la lleva ahora la OMISIÓN de puntos en
    //    `data`. La negativa de 126/R34 —«cero» y «no se sabe» no son el mismo número— sigue en
    //    pie: se expresa con la forma (el día no aparece) en vez de con un campo aparte.
    const schema = openApiSpec.components.schemas.AnaliticaSerie;
    const requeridas = [...schema.required];
    // P4-bis: sin `rango`. Es del sobre, porque las N series de un lote lo comparten por
    // construcción (mismo `raw`, mismo instante).
    expect(requeridas).toEqual(["metrica", "unidad", "data"]);

    const bloque = bloqueDeSchema("AnaliticaSerie");
    const requeridasYaml = subBloque(bloque, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridasYaml).toEqual(requeridas);
    const propiedades = subBloque(bloque, "properties", 6)
      .filter((l) => indent(l) === 8)
      .map((l) => l.trim().replace(/:$/, ""));
    expect(propiedades).toEqual(requeridas);

    // Y el PUNTO tiene exactamente dos campos: nada de `parcial` ni `corteAt`, que dejaron de
    // publicarse el 2026-08-24.
    const punto = schema.properties.data.items;
    expect([...punto.required]).toEqual(["fecha", "valor"]);
    expect(Object.keys(punto.properties)).toEqual(["fecha", "valor"]);
    // Ni el TS ni el `.yaml` mencionan ya ninguno de los cinco campos retirados.
    const serializadoTs = JSON.stringify(openApiSpec.paths[PATH_ANALITICA]) + JSON.stringify(schema);
    const bloqueYaml = bloque.join("\n");
    for (const retirado of [
      "unidadDeConteo",
      "cobertura",
      "fechasNoComparables",
      "penumbra",
      "corteAt",
    ]) {
      expect(serializadoTs).not.toContain(retirado);
      expect(bloqueYaml).not.toContain(retirado);
    }
  });

  it("la descripción del endpoint documenta la UNIDAD DE CONTEO que dejó de viajar en el payload", () => {
    // `unidadDeConteo` salió de la respuesta el 2026-08-24, pero su información NO se perdió:
    // tiene que estar en la prosa del endpoint, o el integrador suma gestiones con órdenes y
    // obtiene un total que no significa nada. Los ids se DERIVAN del catálogo: si mañana una
    // métrica publicable cambia de unidad de conteo o entra una nueva que cuenta gestiones,
    // este test se pone rojo hasta que la prosa lo diga.
    const descripcionTs = openApiSpec.paths[PATH_ANALITICA].get.description;
    const descripcionYaml = descripcionDeAnaliticaEnYaml();

    const porGestion = METRICAS_API_KEY.filter(
      (id) => METRICAS.find((m) => m.id === id)?.unidadDeConteo === "gestion",
    );
    expect(porGestion.length).toBeGreaterThan(0);
    for (const id of porGestion) {
      expect(descripcionTs).toContain(`\`${id}\``);
      expect(descripcionYaml).toContain(`\`${id}\``);
    }
    for (const texto of [descripcionTs, descripcionYaml]) {
      expect(texto).toMatch(/gestiones, no órdenes/i);
      expect(texto).toMatch(/no son sumables/i);
      // Y las dos reglas que sustituyen a lo que se quitó del payload.
      expect(texto).toMatch(/no rellenes los huecos con ceros/i);
      expect(texto).toMatch(/eco EXACTO de lo que pediste, sin recortar/i);
      expect(texto).toMatch(/`null` NO es `0`/);
    }
  });

  it("P4-bis — el sobre `AnaliticaRespuesta` declara rango + metricas[], en el TS y en el .yaml", () => {
    // El sobre es lo que un integrador parsea de verdad. Si el array de series dejara de
    // apuntar a `AnaliticaSerie`, el contrato publicaría dos formas para la misma cosa.
    const schema = openApiSpec.components.schemas.AnaliticaRespuesta;
    expect([...schema.required]).toEqual(["rango", "metricas"]);
    expect(schema.properties.metricas.items).toEqual({
      $ref: "#/components/schemas/AnaliticaSerie",
    });

    const bloque = bloqueDeSchema("AnaliticaRespuesta");
    const requeridasYaml = subBloque(bloque, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridasYaml).toEqual(["rango", "metricas"]);
    expect(bloque.some((l) => l.includes('$ref: "#/components/schemas/AnaliticaSerie"'))).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Feature 266 (R28) — la habilitación por lote, publicada. El canal pasa de NUEVE a DIEZ
// endpoints, y la afirmación se hace sobre los DOS artefactos: el objeto TS y el `.yaml`, en el
// mismo orden y en la misma posición. Mismo criterio que la 255 y la 267: un endpoint de
// ESCRITURA que existe y no está publicado es un contrato que solo conoce quien leyó el código.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("266/R28 — el canal por API key publica DIEZ endpoints, en el objeto TS y en el .yaml", () => {
  it("los dos artefactos declaran diez paths, el mismo décimo y en la misma posición", () => {
    const clavesTs = Object.keys(openApiSpec.paths);
    const clavesYaml = pathsDelYaml();
    expect(clavesTs).toHaveLength(10);
    expect(clavesYaml).toHaveLength(10);
    expect(clavesTs[9]).toBe(PATH_HABILITAR);
    expect(clavesYaml[9]).toBe(PATH_HABILITAR);
    // Espejo exacto: el .yaml es un archivo de texto y nada más lo mantiene sincronizado.
    expect(clavesYaml).toEqual(clavesTs);
  });

  it("el décimo endpoint es POST y devuelve HabilitacionResponse", () => {
    const operacion = openApiSpec.paths[PATH_HABILITAR];
    expect(Object.keys(operacion)).toEqual(["post"]);
    expect(operacion.post.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/HabilitacionResponse",
    });
  });
});
