import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { openApiSpec } from "@/lib/api/openapi-spec";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";

// FICHA 320 — el `DELETE` de una orden propia, publicado en los DOS artefactos del contrato.
//
// POR QUE ESTE ARCHIVO EXISTE. El canal por API key es un contrato publico y su documentacion
// vive DUPLICADA: el objeto TS (`lib/api/openapi-spec.ts`, lo que sirve `/api/docs/openapi` y lo
// que renderiza el Swagger UI) y el `.yaml` (`docs/api/api-key-openapi.yaml`), que dice en su
// cabecera que es generado pero que NADA regenera: lo mantienen sincronizado estos asserts y nada
// mas. Y el censo hermano (`openapi-177-paths-pdf-y-carga-id.test.ts`) compara el spec CONSIGO
// MISMO y con el yaml, nunca contra las rutas reales del filesystem: crear la ruta sin tocar el
// spec sale VERDE y el integrador no se entera de que el endpoint existe. Ese agujero es la razon
// de este archivo — mismo patron que `openapi-266-habilitar.test.ts`.
//
// Un endpoint que borra ordenes y no esta en el contrato publicado es un borrado que nadie puede
// usar (y, peor, uno que nadie sabe que puede ejecutarse con su key).

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

const PATH_ORDEN_POR_ID = "/api/ordenes/api-key/orden/{id}";

const spec = openApiSpec as unknown as {
  paths: Record<
    string,
    Record<
      string,
      { summary: string; operationId: string; description: string; responses: Record<string, unknown> }
    >
  >;
  components: {
    schemas: Record<
      string,
      { type: string; required: string[]; properties: Record<string, Record<string, unknown>> }
    >;
  };
};

/** Sangria de una linea; `null` si esta en blanco. */
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

/** Lineas de una clave anidada del bloque (p. ej. `properties:` a sangria 6). */
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

/** Lineas del bloque `    <verbo>:` bajo un path del yaml. */
function bloqueDeOperacion(pathKey: string, verbo: string): string[] {
  const inicioPath = lineasYaml.findIndex((l) => l === `  "${pathKey}":`);
  if (inicioPath === -1) throw new Error(`El yaml no declara el path ${pathKey}`);
  let inicioVerbo = -1;
  for (let i = inicioPath + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind !== null && ind <= 2) break; // se acabo el path
    if (lineasYaml[i] === `    ${verbo}:`) {
      inicioVerbo = i;
      break;
    }
  }
  if (inicioVerbo === -1) throw new Error(`El yaml no declara ${verbo} en ${pathKey}`);
  const out: string[] = [];
  for (let i = inicioVerbo + 1; i < lineasYaml.length; i++) {
    const ind = indent(lineasYaml[i]);
    if (ind !== null && ind <= 4) break;
    out.push(lineasYaml[i]);
  }
  return out;
}

describe("0 · autocomprobacion de los lectores del yaml", () => {
  it("leen de verdad: encuentran el `get` que ya existia y NO encuentran un verbo inventado", () => {
    // Sin esto, un lector roto devolveria bloques vacios y los asserts de abajo pasarian
    // encontrando la nada.
    expect(bloqueDeOperacion(PATH_ORDEN_POR_ID, "get").join("\n")).toContain(
      "operationId: detalleOrdenPorIdentificador",
    );
    expect(() => bloqueDeOperacion(PATH_ORDEN_POR_ID, "patch")).toThrow();
    expect(() => bloqueDeSchema("SchemaQueNoExiste")).toThrow();
  });
});

describe("FICHA 320 — el DELETE esta publicado en el objeto TS", () => {
  const operacion = spec.paths[PATH_ORDEN_POR_ID]?.delete;

  it("el path de la orden por identificador declara el verbo `delete`", () => {
    expect(operacion).toBeDefined();
    expect(operacion.operationId).toBe("eliminarOrden");
    expect(operacion.summary).toBe("Eliminar una orden propia");
  });

  it("declara los codigos que el borde devuelve de verdad: 200/401/403/404/409/422", () => {
    // Espejo EXACTO de `handleEliminarOrdenApi`: si el handler ganara o perdiera un codigo, el
    // contrato tiene que moverse con el. `toEqual` y no `toContain`, a proposito.
    expect(Object.keys(operacion.responses)).toEqual(["200", "401", "403", "404", "409", "422"]);
  });

  it("el 200 responde `EliminacionResponse`, y el 409 y el 404 reusan los de siempre", () => {
    const r = operacion.responses as Record<string, Record<string, never>>;
    expect(
      (r["200"] as unknown as { content: Record<string, { schema: unknown }> })["content"][
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/EliminacionResponse" });
    expect(r["404"]).toEqual({ $ref: "#/components/responses/NotFound" });
    expect(r["409"]).toEqual({ $ref: "#/components/responses/Conflict" });
  });

  it("la descripcion nombra los CUATRO estados eliminables, uno por uno", () => {
    // El integrador tiene que poder saber CUANDO puede borrar sin leer nuestro codigo. Y se
    // comprueba contra la fuente unica (`ESTADOS_ELIMINABLES`), no contra una lista copiada: si
    // manana la lista cambiara, esta descripcion se queda vieja y este test lo dice.
    for (const estado of ESTADOS_ELIMINABLES) {
      expect(operacion.description).toContain(estado);
    }
    // Y dice que la etiqueta ya impresa NO impide borrar, que es el cambio de la 319.
    expect(operacion.description).toMatch(/etiqueta/i);
    // Y que el identificador puede ser la remision (el caso de la orden sin guia).
    expect(operacion.description).toContain("num_remision");
  });

  it("el schema EliminacionResponse publica las TRES claves, con `numGuia` nullable", () => {
    const schema = spec.components.schemas.EliminacionResponse;
    expect(Object.keys(schema.properties)).toEqual(["numGuia", "numRemision", "estado"]);
    expect([...schema.required]).toEqual(["numGuia", "numRemision", "estado"]);
    // `null` admitido: la orden sin guia es EL caso que motiva la ficha.
    expect(schema.properties.numGuia.type).toEqual(["integer", "null"]);
    expect(schema.properties.numRemision.type).toBe("string");
    // El `estado` devuelto solo puede ser uno de los cuatro: se publica como enum cerrado.
    expect(schema.properties.estado.enum).toEqual([...ESTADOS_ELIMINABLES]);
  });

  it("NO publica ningun campo constante tipo `eliminada: true`", () => {
    // El canal ya retiro `generado` el 2026-08-25 por esto mismo: un campo que no habilita
    // ninguna decision del cliente pero engorda el contrato.
    const schema = spec.components.schemas.EliminacionResponse;
    expect(Object.keys(schema.properties)).not.toContain("eliminada");
  });
});

describe("FICHA 320 — el .yaml publicado dice lo MISMO", () => {
  const bloque = bloqueDeOperacion(PATH_ORDEN_POR_ID, "delete");

  it("declara el `delete` con el mismo operationId y summary", () => {
    expect(bloque.join("\n")).toContain("operationId: eliminarOrden");
    expect(bloque.join("\n")).toContain("summary: Eliminar una orden propia");
  });

  it("declara los mismos seis codigos de respuesta", () => {
    const codigos = subBloque(bloque, "responses", 6)
      .filter((l) => indent(l) === 8)
      .map((l) => l.trim().replace(/:$/, "").replace(/"/g, ""));
    expect(codigos).toEqual(["200", "401", "403", "404", "409", "422"]);
  });

  it("el 200 apunta al mismo schema EliminacionResponse", () => {
    expect(bloque.join("\n")).toContain("$ref: \"#/components/schemas/EliminacionResponse\"");
  });

  it("nombra los cuatro estados eliminables en su descripcion", () => {
    const texto = bloque.join("\n");
    for (const estado of ESTADOS_ELIMINABLES) expect(texto).toContain(estado);
  });

  it("el schema EliminacionResponse del yaml es espejo del TS", () => {
    const schema = bloqueDeSchema("EliminacionResponse");
    const requeridas = subBloque(schema, "required", 6)
      .filter((l) => /^\s*-\s+/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    expect(requeridas).toEqual(["numGuia", "numRemision", "estado"]);

    const propiedades = subBloque(schema, "properties", 6)
      .filter((l) => indent(l) === 8)
      .map((l) => l.trim().replace(/:$/, ""));
    expect(propiedades).toEqual(["numGuia", "numRemision", "estado"]);

    // El enum cerrado de estados, con los cuatro y en el mismo orden que el TS.
    const valores = schema
      .filter((l) => /^\s*-\s+[a-z_]+\s*$/.test(l))
      .map((l) => l.replace(/^\s*-\s+/, "").trim())
      .filter((v) => v !== "numGuia" && v !== "numRemision" && v !== "estado" && v !== "integer");
    expect(valores).toEqual([...ESTADOS_ELIMINABLES]);
  });
});

describe("FICHA 320 — la portada del canal anuncia que se puede eliminar", () => {
  // Es la primera linea que lee un integrador en el Swagger UI, y hasta hoy decia "crear, listar,
  // consultar y cancelar". Un endpoint publicado cuya capacidad no aparece en la portada es un
  // endpoint que solo encuentra quien ya sabia que existe.
  it("el objeto TS lo dice en `info.description`", () => {
    const info = (openApiSpec as unknown as { info: { description: string } }).info;
    expect(info.description).toContain("eliminar");
  });

  it("el .yaml dice exactamente lo mismo", () => {
    expect(yaml).toContain("crear, listar, consultar, cancelar y eliminar órdenes");
  });
});

describe("FICHA 320 — lo que el contrato NO gana", () => {
  it("no se anade ningun evento de webhook: borrar no transiciona la orden", () => {
    // Decision de la ficha: el borrado no escribe historial ni cambia el estado, asi que no hay
    // evento que emitir. Este assert existe para que quede como NO-ACCION deliberada.
    const conWebhooks = openApiSpec as unknown as { webhooks: Record<string, unknown> };
    expect(Object.keys(conWebhooks.webhooks)).not.toContain("orden.eliminada");
    expect(yaml).not.toContain("orden.eliminada");
  });
});

// =================================================================================================
// LOS OTROS DOS ARTEFACTOS DEL CANAL — coleccion de Postman y CHANGELOG. Mismo criterio que la 266
// (T7.2): se PARSEA y se afirma, no se hace `grep` de «existe el archivo». El CHANGELOG es lo que
// se copia y se manda a los integradores como aviso; si el endpoint no esta ahi, el aviso no existe.
// =================================================================================================
const POSTMAN_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "api",
  "ordenex-api-key.postman_collection.json",
);
const CHANGELOG_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "CHANGELOG.md");

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: { method: string; url: { raw: string } };
}

function peticionesPlanas(items: PostmanItem[]): PostmanItem[] {
  const planas: PostmanItem[] = [];
  const recorrer = (lista: PostmanItem[]) =>
    lista.forEach((i) => (i.item ? recorrer(i.item) : planas.push(i)));
  recorrer(items);
  return planas;
}

describe("FICHA 320 — la coleccion de Postman publica el DELETE y sigue siendo JSON valido", () => {
  const coleccion = JSON.parse(fs.readFileSync(POSTMAN_PATH, "utf8")) as { item: PostmanItem[] };

  it("el archivo entero parsea como JSON", () => {
    expect(Array.isArray(coleccion.item)).toBe(true);
  });

  it("hay peticiones DELETE, y TODAS van a `/api-key/orden/{id}`", () => {
    const planas = peticionesPlanas(coleccion.item);
    const borrados = planas.filter((i) => i.request?.method === "DELETE");
    expect(borrados.length).toBeGreaterThan(0);
    for (const peticion of borrados) {
      expect(peticion.request?.url.raw).toContain("/api/ordenes/api-key/orden/");
    }
  });

  it("cubre los dos identificadores (guia y remision) y los dos rechazos (404 y 409)", () => {
    const nombres = peticionesPlanas(coleccion.item)
      .filter((i) => i.request?.method === "DELETE")
      .map((i) => i.name)
      .join(" | ");
    expect(nombres).toMatch(/remisi/i);
    expect(nombres).toMatch(/gu[ií]a/i);
    expect(nombres).toContain("404");
    expect(nombres).toContain("409");
  });
});

describe("FICHA 320 — el CHANGELOG del canal tiene la entrada fechada del endpoint nuevo", () => {
  const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");

  it("existe la entrada del 2026-08-28 y nombra la ruta y el verbo", () => {
    expect(changelog).toContain("## 2026-08-28");
    expect(changelog).toContain("DELETE /ordenes/api-key/orden/{id}");
  });

  it("el aviso dice CUANDO procede: los cuatro estados, uno por uno", () => {
    // Es el texto que un integrador recibe y sobre el que decide si le sirve. Si la lista cambiara
    // y este aviso no, el integrador estaria programando contra una regla que ya no existe.
    for (const estado of ESTADOS_ELIMINABLES) expect(changelog).toContain(estado);
  });
});
