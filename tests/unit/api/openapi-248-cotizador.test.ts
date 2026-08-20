import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// Feature 248 (R22, R28, R31, R32, R34, R37) — lo que el contrato publicado del COTIZADOR
// TIENE QUE DECIR, no solo cual es su forma.
//
// La forma de la respuesta la fija `tests/integration/api/cotizar-api-key.test.ts` (con `toEqual`)
// y la lista firmada de paths la fija `openapi-177-paths-pdf-y-carga-id.test.ts` (7 -> 8). Este
// archivo mide las CINCO ADVERTENCIAS que un integrador no puede deducir de la forma:
//
//   R22 — el neto de DEVUELTA es negativo y NO existe en el cierre (no se cuadra contra el).
//   R28 — el supuesto de homogeneidad de la cotizacion multiple (mismo distrito y mismo monto).
//   R31 — la deuda heredada de `tarifas.status` (una tarifa `inactivo` no borrada se cotiza).
//   R32 — `fulfillment` NO se cotiza: no aparece en ninguna respuesta ni en ningun schema.
//   R34 — `cobra_comision` publicado CON su default `true`.
//
// Cada afirmacion se hace sobre los DOS artefactos: el objeto TS (fuente de verdad) y el `.yaml`
// (espejo textual). El `.yaml` es un archivo de texto y NADA MAS lo mantiene sincronizado: si una
// advertencia solo viviera en el TS, el integrador que lee el `.yaml` publicado no la veria.
// R37 anade el tercer artefacto: la coleccion de Postman.

const DOCS = path.join(__dirname, "..", "..", "..", "docs", "api");
const YAML_PATH = path.join(DOCS, "api-key-openapi.yaml");
const POSTMAN_PATH = path.join(DOCS, "ordenex-api-key.postman_collection.json");

const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);
const postman = JSON.parse(fs.readFileSync(POSTMAN_PATH, "utf8")) as PostmanCollection;

const PATH_COTIZAR = "/api/ordenes/api-key/cotizar";

/** Colapsa saltos de linea y espacios: el TS parte las frases con `join("\n")` y el yaml con `|-`. */
function norm(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Sangria (n.º de espacios) de una linea; `null` si esta en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Lineas del bloque `<cabecera>` del yaml, sin su cabecera, hasta que la sangria vuelve a bajar. */
function bloqueYaml(cabecera: string): string[] {
  const inicio = lineasYaml.findIndex((l) => l === cabecera);
  if (inicio === -1) throw new Error(`El yaml no declara ${cabecera.trim()}`);
  const sangriaCabecera = indent(cabecera)!;
  const out: string[] = [];
  for (let i = inicio + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind !== null && ind <= sangriaCabecera) break;
    out.push(lineasYaml[i]);
  }
  if (out.length === 0) throw new Error(`El bloque ${cabecera.trim()} esta vacio`);
  return out;
}

/** Texto normalizado del bloque de un schema de `components.schemas`. */
function textoSchemaYaml(nombre: string): string {
  return norm(bloqueYaml(`    ${nombre}:`).join("\n"));
}

/** Texto normalizado del bloque de un path de `paths`. */
function textoPathYaml(clave: string): string {
  return norm(bloqueYaml(`  "${clave}":`).join("\n"));
}

/* -------------------------------------------------------------------------------------------- */
/* Barrido generico del objeto TS: cada string (clave o valor) con su ruta.                       */
/* -------------------------------------------------------------------------------------------- */

interface Aparicion {
  readonly ruta: string;
  readonly texto: string;
}

/** Todas las cadenas del arbol (valores) y todos los nombres de clave, con su ruta. */
function recorrer(nodo: unknown, ruta: string, out: Aparicion[]): Aparicion[] {
  if (typeof nodo === "string") {
    out.push({ ruta, texto: nodo });
    return out;
  }
  if (Array.isArray(nodo)) {
    nodo.forEach((item, i) => recorrer(item, `${ruta}[${i}]`, out));
    return out;
  }
  if (nodo && typeof nodo === "object") {
    for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
      out.push({ ruta: `${ruta}.<clave>`, texto: clave });
      recorrer(valor, `${ruta}.${clave}`, out);
    }
  }
  return out;
}

const TODAS_LAS_CADENAS = recorrer(openApiSpec, "$", []);

const cotizar = openApiSpec.paths[PATH_COTIZAR].post;
const descripcionCotizar = norm(cotizar.description);
const schemas = openApiSpec.components.schemas;

/* -------------------------------------------------------------------------------------------- */
/* R22 — el neto de DEVUELTA no existe en el cierre                                               */
/* -------------------------------------------------------------------------------------------- */

describe("248/R22 — el contrato advierte que el neto de devuelta no existe en el cierre", () => {
  const netoDevuelta = schemas.ImportesDevuelta.properties.netoTienda;
  const descripcionNeto = norm(netoDevuelta.description);
  const schemaYaml = textoSchemaYaml("ImportesDevuelta");
  const pathYaml = textoPathYaml(PATH_COTIZAR);

  it("el objeto TS lo dice en el schema del importe y en la descripcion del endpoint", () => {
    for (const texto of [descripcionNeto, descripcionCotizar]) {
      expect(texto).toContain("NO EXISTE EN EL CIERRE");
      expect(texto).toContain("no debe cuadrarse contra ninguna línea de cierre");
      expect(texto).toContain("del cotizador");
    }
    // Y dice POR QUE, que es lo que evita que alguien lo lea como un bug del cierre.
    expect(descripcionNeto).toContain("no descuenta el flete de devolución");
    expect(descripcionNeto).toContain("no recauda COD");
    expect(descripcionCotizar).toContain("no descuenta el flete de devolución");
  });

  it("el objeto TS publica el neto como NEGATIVO, con ejemplo negativo y patron que lo admite", () => {
    expect(descripcionNeto).toContain("**NEGATIVO**");
    expect(netoDevuelta.type).toBe("string"); // string money-safe, nunca number
    expect(netoDevuelta.example).toBe("-1695.00");
    expect(new RegExp(netoDevuelta.pattern).test("-1695.00")).toBe(true);
    // Contraprueba del patron: no vale cualquier cosa (ni escala distinta de 2).
    expect(new RegExp(netoDevuelta.pattern).test("-1695")).toBe(false);
    expect(new RegExp(netoDevuelta.pattern).test("-1695.000")).toBe(false);
  });

  it("el .yaml publicado lleva la misma advertencia, en el schema y en el endpoint", () => {
    for (const texto of [schemaYaml, pathYaml]) {
      expect(texto).toContain("NO EXISTE EN EL CIERRE");
      expect(texto).toContain("no debe cuadrarse contra ninguna línea de cierre");
    }
    expect(schemaYaml).toContain("**NEGATIVO**");
    expect(schemaYaml).toContain("no descuenta el flete de devolución");
    expect(schemaYaml).toContain('example: "-1695.00"');
  });

  it("no-vacuidad: los textos medidos existen y una frase ajena NO aparece", () => {
    expect(descripcionNeto.length).toBeGreaterThan(200);
    expect(schemaYaml.length).toBeGreaterThan(200);
    expect(descripcionNeto).not.toContain("cuadra con la línea de cierre");
    expect(schemaYaml).not.toContain("cuadra con la línea de cierre");
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R28 — supuesto de homogeneidad                                                                 */
/* -------------------------------------------------------------------------------------------- */

describe("248/R28 — el contrato declara el supuesto de homogeneidad de la cotizacion multiple", () => {
  const supuesto = norm(schemas.CotizacionConCostos.properties.supuesto.description);
  const supuestoYaml = textoSchemaYaml("CotizacionConCostos");

  it("el objeto TS dice que las N ordenes comparten distrito y monto, y por que importa", () => {
    for (const texto of [supuesto, descripcionCotizar]) {
      expect(texto).toContain("distrito y monto a cobrar");
    }
    expect(supuesto).toContain("canasta heterogénea");
    expect(supuesto).toContain("porcentaje del monto");
    expect(descripcionCotizar).toContain("no son una multiplicación");
    // El campo va en `required`: el supuesto viaja SIEMPRE, no solo cuando cantidad > 1.
    expect([...schemas.CotizacionConCostos.required]).toContain("supuesto");
  });

  it("el .yaml publicado declara el mismo supuesto", () => {
    expect(supuestoYaml).toContain("distrito y monto a cobrar");
    expect(supuestoYaml).toContain("canasta heterogénea");
    expect(textoPathYaml(PATH_COTIZAR)).toContain("distrito y monto a cobrar");
  });

  it("no-vacuidad: el texto medido existe", () => {
    expect(supuesto.length).toBeGreaterThan(150);
    expect(supuestoYaml.length).toBeGreaterThan(150);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R31 — deuda heredada de `tarifas.status`                                                       */
/* -------------------------------------------------------------------------------------------- */

describe("248/R31 — el contrato declara la deuda de status", () => {
  const tarifaVigente = norm(schemas.CotizacionConCostos.properties.tarifaVigente.description);
  const bloqueYamlConCostos = textoSchemaYaml("CotizacionConCostos");
  const pathYaml = textoPathYaml(PATH_COTIZAR);

  it("el objeto TS dice que la tarifa es la mas reciente NO BORRADA y que no se filtra status", () => {
    for (const texto of [tarifaVigente, descripcionCotizar]) {
      expect(texto).toContain("más reciente **no borrada**");
      expect(texto).toContain("no filtra por `tarifas.status`");
      expect(texto).toContain("`inactivo` que no haya sido borrada puede cotizarse");
    }
    // Y que es HEREDADA, no introducida por el cotizador: el arreglo es otra ficha.
    expect(tarifaVigente).toContain("hereda esa deuda, no la introduce");
    expect(descripcionCotizar).toContain("hereda** esa deuda, no la introduce");
  });

  it("el .yaml publicado declara la misma deuda, en el schema y en el endpoint", () => {
    for (const texto of [bloqueYamlConCostos, pathYaml]) {
      expect(texto).toContain("más reciente **no borrada**");
      expect(texto).toContain("no filtra por `tarifas.status`");
      expect(texto).toContain("`inactivo` que no haya sido borrada puede cotizarse");
    }
  });

  it("no-vacuidad: el contrato NO promete lo contrario (que solo cotice tarifas activas)", () => {
    expect(tarifaVigente.length).toBeGreaterThan(200);
    for (const texto of [tarifaVigente, descripcionCotizar, bloqueYamlConCostos, pathYaml]) {
      expect(texto).not.toContain("solo se cotizan tarifas activas");
      expect(texto).not.toContain('filtra por `status: "activo"`');
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R32 — `fulfillment` no se cotiza                                                               */
/* -------------------------------------------------------------------------------------------- */

describe("248/R32 — ni la respuesta ni ningun schema publicado mencionan fulfillment", () => {
  const RE = /fulfillment/i;

  // Las UNICAS apariciones admitidas en todo el contrato son DECLARACIONES EN NEGATIVO, y ambas
  // viven en prosa de `description`, nunca en una clave, un enum, un ejemplo ni un schema:
  //   1. feature 155/R42 — el estado interno de bodega fue RETIRADO del catalogo;
  //   2. feature 248/R32 — el cotizador NO lo cotiza.
  // Cualquier otra aparicion (o que una de estas dejara de ser una negacion) pone rojo el test.
  const APARICIONES_ADMITIDAS = [
    "$.paths./api/ordenes/api-key/carga.post.description",
    `$.paths.${PATH_COTIZAR}.post.description`,
  ];

  it("el objeto TS solo lo menciona en las dos declaraciones en negativo, y en ningun otro sitio", () => {
    const apariciones = TODAS_LAS_CADENAS.filter((a) => RE.test(a.texto));
    expect(apariciones.map((a) => a.ruta).sort()).toEqual([...APARICIONES_ADMITIDAS].sort());
    for (const aparicion of apariciones) {
      expect(norm(aparicion.texto)).toMatch(/fue retirado del catálogo|no se cotiza/);
    }
  });

  it("ninguna clave, enum, ejemplo ni patron del objeto TS lo nombra", () => {
    const fuera = TODAS_LAS_CADENAS.filter(
      (a) => RE.test(a.texto) && !a.ruta.endsWith(".description"),
    );
    expect(fuera).toEqual([]);
  });

  it("ningun schema publicado lo menciona (barrido del subarbol components.schemas)", () => {
    const enSchemas = recorrer(schemas, "$.components.schemas", []).filter((a) => RE.test(a.texto));
    expect(enSchemas).toEqual([]);
  });

  it("la respuesta del cotizador no lo lleva en ningun ejemplo ni en ningun campo", () => {
    const respuesta = cotizar.responses["200"];
    const enRespuesta = recorrer(respuesta, "$.respuesta", []).filter((a) => RE.test(a.texto));
    expect(enRespuesta).toEqual([]);
    // Y el endpoint lo DICE, para que la ausencia no se lea como un olvido.
    expect(descripcionCotizar).toContain("`fulfillment` no se cotiza");
  });

  it("el .yaml publicado lo menciona en exactamente dos lineas, ambas en negativo", () => {
    const ofensoras = lineasYaml.filter((l) => RE.test(l));
    expect(ofensoras).toHaveLength(2);
    for (const linea of ofensoras) {
      expect(linea).toMatch(/fue retirado del catálogo|no se cotiza/);
    }
    // Ninguna de las dos es una clave de schema ni un item de enum.
    for (const linea of ofensoras) {
      expect(linea.trim()).not.toMatch(/^-\s/);
      expect(linea.trim()).not.toMatch(/^[A-Za-z_]+:/);
    }
  });

  it("no-vacuidad: el barrido si encuentra cosas (no esta mirando un arbol vacio)", () => {
    expect(TODAS_LAS_CADENAS.length).toBeGreaterThan(500);
    expect(TODAS_LAS_CADENAS.filter((a) => /netoTienda/.test(a.texto)).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R34 — `cobra_comision` con su default `true`                                                   */
/* -------------------------------------------------------------------------------------------- */

describe("248/R34 — cobra_comision se publica con default true en el TS y en el yaml", () => {
  const cobraComision = schemas.CotizacionRequest.properties.cobra_comision;

  it("el objeto TS lo declara booleano, opcional y con `default: true`", () => {
    expect(cobraComision.type).toBe("boolean");
    expect(cobraComision.default).toBe(true);
    expect([...schemas.CotizacionRequest.required]).not.toContain("cobra_comision");
  });

  it("el objeto TS escribe el default en prosa y explica por que es el caso caro", () => {
    const texto = norm(cobraComision.description);
    expect(texto).toContain("Ausente vale `true`");
    expect(texto).toContain("caso caro");
    // Y la consecuencia con `false`: los conceptos se OMITEN, no van en "0.00".
    expect(texto).toContain("omite");
    expect(norm(schemas.ImportesEntregada.description)).toContain("se OMITEN");
    expect([...schemas.ImportesEntregada.required]).not.toContain("comisionCod");
    expect([...schemas.ImportesEntregada.required]).not.toContain("ivaComisionCod");
    // La respuesta hace eco del valor aplicado: no hay que adivinar que se cotizo.
    expect([...schemas.CotizacionConCostos.required]).toContain("cobraComision");
  });

  it("el .yaml publicado declara el mismo default y la misma prosa", () => {
    const bloque = bloqueYaml("        cobra_comision:");
    const texto = norm(bloque.join("\n"));
    expect(texto).toContain("type: boolean");
    expect(texto).toContain("default: true");
    expect(texto).toContain("Ausente vale `true`");
    // El schema que lo contiene es el del cuerpo de la peticion, y no lo exige.
    expect(textoSchemaYaml("CotizacionRequest")).toContain("cobra_comision");
    expect(textoSchemaYaml("ImportesEntregada")).toContain("se OMITEN");
  });

  it("no-vacuidad: `cantidad` tambien publica su default (1) y su rango 1..1000", () => {
    const cantidad = schemas.CotizacionRequest.properties.cantidad;
    expect(cantidad.default).toBe(1);
    expect(cantidad.minimum).toBe(1);
    expect(cantidad.maximum).toBe(1000);
    expect(norm(textoSchemaYaml("CotizacionRequest"))).toContain("default: 1");
  });
});

/* -------------------------------------------------------------------------------------------- */
/* R37 — los tres artefactos publican el endpoint                                                 */
/* -------------------------------------------------------------------------------------------- */

interface PostmanRequest {
  readonly name: string;
  readonly request: {
    readonly method: string;
    readonly auth?: { readonly type: string };
    readonly url: { readonly raw: string; readonly path?: readonly string[] };
    readonly body?: { readonly mode: string; readonly raw: string };
  };
}

interface PostmanFolder {
  readonly name: string;
  readonly description?: string;
  readonly item: readonly PostmanRequest[];
}

interface PostmanCollection {
  readonly info: { readonly description: string };
  readonly auth: { readonly type: string; readonly bearer: readonly { key: string; value: string }[] };
  readonly item: readonly PostmanFolder[];
}

describe("248/R37 — la coleccion postman incluye el request de cotizacion", () => {
  const carpeta = postman.item.find((f) => f.item.some((r) => /\/cotizar$/.test(r.request.url.raw)));

  it("hay una carpeta numerada para el cotizador, con el mismo path que el OpenAPI", () => {
    expect(carpeta).toBeDefined();
    expect(carpeta!.name).toMatch(/^\d+ · /);
    const requests = carpeta!.item.filter((r) => /\/cotizar$/.test(r.request.url.raw));
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.request.method).toBe("POST"); // el monto COD no viaja en la URL
      expect(r.request.url.raw).toBe(`{{baseUrl}}${PATH_COTIZAR}`);
      expect(r.request.url.path).toEqual(["api", "ordenes", "api-key", "cotizar"]);
    }
  });

  it("las peticiones van autenticadas con la API key de la coleccion (Bearer {{apiKey}})", () => {
    expect(postman.auth.type).toBe("bearer");
    expect(postman.auth.bearer.find((b) => b.key === "token")?.value).toBe("{{apiKey}}");
    // Ningun request del cotizador se sale de esa auth heredada (los `noauth` son los 401 a proposito).
    for (const r of carpeta!.item) expect(r.request.auth).toBeUndefined();
  });

  it("al menos un cuerpo de ejemplo lleva cantidad y cobra_comision, y el monto como cadena", () => {
    const cuerpos = carpeta!.item
      .map((r) => r.request.body?.raw)
      .filter((raw): raw is string => typeof raw === "string")
      .map((raw) => JSON.parse(raw) as Record<string, unknown>);
    expect(cuerpos.length).toBeGreaterThan(0);
    const completo = cuerpos.find((c) => "cantidad" in c && "cobra_comision" in c);
    expect(completo).toBeDefined();
    expect(typeof completo!.cantidad).toBe("number");
    expect(typeof completo!.cobra_comision).toBe("boolean");
    for (const cuerpo of cuerpos) {
      expect(typeof cuerpo.monto_cobrar).toBe("string"); // money-safe: nunca un number
      expect(cuerpo.provincia).toBeDefined();
      expect(cuerpo.canton).toBeDefined();
      expect(cuerpo.distrito).toBeDefined();
      expect(Object.keys(cuerpo)).not.toContain("tiendaId"); // la tienda sale de la key
    }
  });

  it("la carpeta incluye el caso de error 422 por cantidad fuera de rango", () => {
    const fueraDeRango = carpeta!.item.find((r) => /422.*cantidad/i.test(r.name));
    expect(fueraDeRango).toBeDefined();
    const cuerpo = JSON.parse(fueraDeRango!.request.body!.raw) as { cantidad: number };
    expect(cuerpo.cantidad).toBeGreaterThan(1000);
  });

  it("la coleccion anuncia los ocho endpoints, tantos como paths publica el OpenAPI", () => {
    expect(Object.keys(openApiSpec.paths)).toHaveLength(8);
    expect(postman.info.description).toContain("Los 8 endpoints");
  });
});
