import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { openApiSpec } from "@/lib/api/openapi-spec";
import { TOPE_FILAS_HABILITAR } from "@/lib/config/habilitacion-api";

// Feature 266 (T7.1, R28) — el endpoint de HABILITACION POR LOTE, publicado en los DOS artefactos.
//
// El `.yaml` es un archivo de TEXTO y nada lo mantiene sincronizado con el objeto TS salvo estos
// asserts, asi que cada afirmacion se hace sobre los dos. El censo de paths (los NUEVE endpoints
// del canal) vive en `openapi-177-paths-pdf-y-carga-id.test.ts`, que esta feature sube de ocho a
// nueve en este mismo commit; aqui se afirma el CONTENIDO del noveno.
//
// ⚠️ NO SE ANADE NADA A LA SECCION `webhooks:` (decision firmada 2 del design): la rama A emite el
// evento de estado de SIEMPRE y la rama B no emite nada. Hay un assert de esa no-accion abajo.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");

const PATH_HABILITAR = "/api/ordenes/api-key/habilitar";
const RESULTADOS = ["habilitada", "habilitada_sin_cambio_de_estado", "error"];
const CODIGOS = ["fila_invalida", "duplicada_en_lote", "no_encontrada", "estado_no_habilitable"];

const spec = openApiSpec as unknown as {
  paths: Record<string, Record<string, { description: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Record<string, unknown>> };
  webhooks: Record<string, unknown>;
};

/** Bloque de lineas de `    <nombre>:` dentro de `components.schemas` del yaml. */
function bloqueDeSchema(nombre: string): string[] {
  const lineas = yaml.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === `    ${nombre}:`);
  if (inicio === -1) throw new Error(`El yaml no declara el schema ${nombre}`);
  const out: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.trim() !== "" && linea.length - linea.trimStart().length <= 4) break;
    out.push(linea);
  }
  return out;
}

/** Los bloques `enum:` de un schema del yaml, en orden de declaracion y con sus valores. */
function enumsDelBloque(bloque: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < bloque.length; i++) {
    if (!/^\s*enum:\s*$/.test(bloque[i])) continue;
    const sangria = bloque[i].length - bloque[i].trimStart().length;
    const valores: string[] = [];
    for (let j = i + 1; j < bloque.length; j++) {
      const linea = bloque[j];
      const ind = linea.length - linea.trimStart().length;
      if (linea.trim() === "" || ind <= sangria || !/^\s*-\s+/.test(linea)) break;
      valores.push(linea.replace(/^\s*-\s+/, "").trim());
    }
    out.push(valores);
  }
  return out;
}

describe("266/R28 — el noveno endpoint del canal existe en el objeto TS y en el .yaml", () => {
  it("el path se publica como POST en los dos artefactos", () => {
    expect(Object.keys(spec.paths)).toContain(PATH_HABILITAR);
    expect(Object.keys(spec.paths[PATH_HABILITAR])).toEqual(["post"]);
    expect(yaml).toContain(`  "${PATH_HABILITAR}":`);
    expect(yaml).toContain("operationId: habilitarOrdenes");
  });

  it("responde 200 con HabilitacionResponse y reutiliza los errores globales 401/403/422", () => {
    const post = spec.paths[PATH_HABILITAR].post as unknown as {
      responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
    };
    expect(Object.keys(post.responses)).toEqual(["200", "401", "403", "422"]);
    expect(post.responses["200"].content?.["application/json"].schema).toEqual({
      $ref: "#/components/schemas/HabilitacionResponse",
    });
    for (const [codigo, nombre] of [
      ["401", "Unauthorized"],
      ["403", "Forbidden"],
      ["422", "ValidationError"],
    ]) {
      expect(post.responses[codigo]).toEqual({ $ref: `#/components/responses/${nombre}` });
    }
  });
});

describe("266/R10 y R28 — los tres desenlaces y los cuatro codigos de error son un conjunto cerrado", () => {
  it("el enum de `resultado` publica los TRES desenlaces, y solo esos", () => {
    const fila = spec.components.schemas.HabilitacionRowResult as {
      properties: { resultado: { enum: string[] } };
    };
    expect(fila.properties.resultado.enum).toEqual(RESULTADOS);
  });

  it("el enum de `error.codigo` publica los CUATRO codigos, y solo esos", () => {
    const fila = spec.components.schemas.HabilitacionRowResult as {
      properties: { error: { properties: { codigo: { enum: string[] } } } };
    };
    expect(fila.properties.error.properties.codigo.enum).toEqual(CODIGOS);
  });

  it("el .yaml declara los MISMOS dos enums, en el mismo orden (paridad objeto <-> espejo)", () => {
    // Se leen los BLOQUES `enum:` del schema, no cualquier linea con guion: `required:` tambien
    // usa guiones y sus nombres de propiedad (`error`) colisionan con los valores del enum.
    const enums = enumsDelBloque(bloqueDeSchema("HabilitacionRowResult"));
    expect(enums).toEqual([RESULTADOS, CODIGOS]);
  });
});

describe("266/D1-D2 — la descripcion publicada dice lo que el integrador no puede adivinar", () => {
  const descripcion = spec.paths[PATH_HABILITAR].post.description;

  it("nombra los DOS estados habilitables y deja fuera `reprogramada` por su nombre", () => {
    expect(descripcion).toContain("`ayuda_tienda` y `devuelta`");
    expect(descripcion).toMatch(/`reprogramada`\s+\*\*NO\*\*\s+es habilitable/);
    expect(descripcion).toContain("estado_no_habilitable");
  });

  it("declara que una `devuelta` NUNCA cambia de estado", () => {
    // Es la mitad del contrato que no se puede deducir del schema: un integrador que mande un
    // lote de `devuelta`s recibira `habilitada_sin_cambio_de_estado` en el 100 % de las filas.
    expect(descripcion).toMatch(/`devuelta`\s+NUNCA cambia de estado/);
    expect(descripcion).toContain("habilitada_sin_cambio_de_estado");
  });

  it(`declara el tope de ${TOPE_FILAS_HABILITAR} filas por lote, y el schema lo aplica`, () => {
    expect(descripcion).toContain(`entre 1 y ${TOPE_FILAS_HABILITAR} filas`);
    const request = spec.components.schemas.HabilitacionRequest as {
      properties: { ordenes: { minItems: number; maxItems: number } };
    };
    expect(request.properties.ordenes.minItems).toBe(1);
    expect(request.properties.ordenes.maxItems).toBe(TOPE_FILAS_HABILITAR);
  });

  it("el .yaml publica las MISMAS tres afirmaciones: si uno las dice y el otro no, uno miente", () => {
    expect(yaml).toContain("**Solo DOS estados son habilitables: `ayuda_tienda` y `devuelta`.**");
    expect(yaml).toMatch(/`reprogramada`\s+\*\*NO\*\*\s+es habilitable/);
    expect(yaml).toMatch(/`devuelta`\s+NUNCA cambia de estado/);
    expect(yaml).toContain(`**El lote acepta entre 1 y ${TOPE_FILAS_HABILITAR} filas.**`);
    expect(yaml).toContain(`maxItems: ${TOPE_FILAS_HABILITAR}`);
  });
});

describe("266 — la rama B es deuda declarada: el contrato NO gana ningun evento nuevo", () => {
  it("la seccion `webhooks:` sigue teniendo un unico evento y no menciona la habilitacion", () => {
    // La rama B no notifica y no se deja ningun gancho «por si acaso». Si alguien anadiera
    // `orden.habilitada`, este assert cae con el nombre de la decision que lo prohibe.
    expect(Object.keys(spec.webhooks)).toEqual(["orden.estado_actualizado"]);
    expect(JSON.stringify(spec.webhooks)).not.toContain("habilitada");
    expect(JSON.stringify(spec.webhooks)).not.toContain("habilitacion");
  });
});

// =================================================================================================
// T7.2 — POSTMAN Y CHANGELOG. El criterio de «hecho» de esta ficha es un ASSERT que se ejecuta, no
// un `grep`: la coleccion se PARSEA (y sus cuerpos tambien) y la entrada del changelog se busca por
// su fecha, no por «existe el archivo».
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
  request?: { method: string; url: { raw: string }; body?: { raw: string } };
}

describe("266/T7.2 — la coleccion de Postman publica el endpoint y sigue siendo JSON valido", () => {
  const coleccion = JSON.parse(fs.readFileSync(POSTMAN_PATH, "utf8")) as { item: PostmanItem[] };

  it("el archivo entero parsea como JSON", () => {
    expect(Array.isArray(coleccion.item)).toBe(true);
  });

  it("hay al menos una peticion POST a la ruta nueva", () => {
    const planas: PostmanItem[] = [];
    const recorrer = (items: PostmanItem[]) =>
      items.forEach((i) => (i.item ? recorrer(i.item) : planas.push(i)));
    recorrer(coleccion.item);
    const habilitar = planas.filter((i) => i.request?.url.raw.endsWith("/api-key/habilitar"));
    expect(habilitar.length).toBeGreaterThan(0);
    for (const peticion of habilitar) expect(peticion.request?.method).toBe("POST");
  });

  it("los cuerpos de ejemplo son JSON valido con la clave `ordenes`", () => {
    // Un ejemplo que no parsea es peor que no tener ejemplo: el integrador lo copia tal cual.
    const planas: PostmanItem[] = [];
    const recorrer = (items: PostmanItem[]) =>
      items.forEach((i) => (i.item ? recorrer(i.item) : planas.push(i)));
    recorrer(coleccion.item);
    const cuerpos = planas
      .filter((i) => i.request?.url.raw.endsWith("/api-key/habilitar"))
      .map((i) => i.request?.body?.raw ?? "");
    expect(cuerpos.length).toBeGreaterThan(0);
    for (const crudo of cuerpos) {
      const parseado = JSON.parse(crudo) as { ordenes: unknown };
      expect(Array.isArray(parseado.ordenes)).toBe(true);
    }
  });
});

describe("266/T7.2 — el CHANGELOG del canal tiene la entrada fechada del endpoint nuevo", () => {
  const changelog = fs.readFileSync(CHANGELOG_PATH, "utf8");

  it("existe la entrada del 2026-08-23 y nombra la ruta", () => {
    expect(changelog).toContain("## 2026-08-23");
    expect(changelog).toContain("`POST /api/ordenes/api-key/habilitar`");
  });

  it("el aviso repite las tres cosas del contrato que el integrador no puede adivinar", () => {
    // El texto de la entrada ES el aviso que se copia y se manda: si no dice esto, el integrador
    // se entera implementando.
    expect(changelog).toContain("`ayuda_tienda` y `devuelta`");
    expect(changelog).toMatch(/`devuelta` nunca cambia de estado/i);
    expect(changelog).toContain("entre 1 y 100 filas");
  });
});
