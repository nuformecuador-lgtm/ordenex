import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";

// Feature 257 (R26) — contrato publicado de los cuatro filtros nuevos del listado por API key
// (`desde`, `hasta`, `num_guia`, `num_remision`) sobre `GET /api/ordenes/api-key`.
//
// Por que existe esta guardia: el contrato vive DOS veces. `lib/api/openapi-spec.ts` es el objeto
// que sirve `/api/docs/openapi` y renderiza Swagger UI; `docs/api/api-key-openapi.yaml` es un
// espejo TEXTUAL que nada valida ni genera. Un parametro documentado en el TS pero ausente del
// yaml (o al reves) deja al integrador leyendo un contrato falso: pide `?hasta=...` porque el yaml
// no lo menciona, o lo manda mal porque el yaml quedo con el tipo viejo. Por eso cada afirmacion
// se hace sobre AMBOS artefactos.
//
// Ademas la feature es ADITIVA: `limit`, `offset` y `estado` no cambian de semantica ni pueden
// desaparecer, y aqui se afirma que siguen publicados.
// La guardia hermana `openapi-177-paths-pdf-y-carga-id.test.ts` cubre los paths y `CargaResponse`;
// esta solo cubre los parameters del listado y la descripcion del endpoint.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");
const lineasYaml = yaml.split(/\r?\n/);

const PATH_LISTADO = "/api/ordenes/api-key";

/** Sangría (nº de espacios) de una línea; `null` si está en blanco. */
function indent(linea: string): number | null {
  if (linea.trim() === "") return null;
  return linea.length - linea.trimStart().length;
}

/** Líneas anidadas bajo `lineas[indice]`, sin su cabecera: todo lo que sangra más que ella. */
function anidadasDesde(lineas: string[], indice: number): string[] {
  const base = indent(lineas[indice]) ?? 0;
  const out: string[] = [];
  for (let i = indice + 1; i < lineas.length; i++) {
    const ind = indent(lineas[i]);
    if (ind !== null && ind <= base) break;
    out.push(lineas[i]);
  }
  return out;
}

/** Índice de la primera línea que casa `re`, o error con contexto si no está. */
function indiceDe(lineas: string[], re: RegExp, queBuscaba: string): number {
  const i = lineas.findIndex((l) => re.test(l));
  if (i === -1) throw new Error(`El yaml no declara ${queBuscaba}`);
  return i;
}

/** Líneas del bloque de una clave (`clave:` a la sangría dada), sin su cabecera. */
function subBloque(lineas: string[], clave: string, sangria: number): string[] {
  const re = new RegExp(`^ {${sangria}}${clave}:`);
  return anidadasDesde(lineas, indiceDe(lineas, re, `\`${clave}\` a sangría ${sangria}`));
}

/** Líneas del `get:` de un path del yaml (`  "<path>":` → `    get:`), sin cabeceras. */
function bloqueDelGet(pathKey: string): string[] {
  const lineasPath = anidadasDesde(
    lineasYaml,
    indiceDe(lineasYaml, new RegExp(`^ {2}"${pathKey}":$`), `el path ${pathKey}`)
  );
  return subBloque(lineasPath, "get", 4);
}

const lineasGet = bloqueDelGet(PATH_LISTADO);
/** Bloque `parameters:` del `get` del listado (las entradas `- name: ...` van a sangría 8). */
const lineasParameters = subBloque(lineasGet, "parameters", 6);
/** Descripción del endpoint en el yaml, ya como texto plano. */
const descripcionYaml = subBloque(lineasGet, "description", 6)
  .map((l) => l.trim())
  .join("\n");

/** Líneas de un parámetro concreto del bloque `parameters:` (todo lo que cuelga de `- name: X`). */
function bloqueDeParametro(nombre: string): string[] {
  const i = indiceDe(
    lineasParameters,
    new RegExp(`^ {8}- name: ${nombre}$`),
    `el parámetro \`${nombre}\` dentro de parameters`
  );
  // La entrada de lista sangra 8 y su cuerpo 10: `anidadasDesde` recorta exactamente el cuerpo.
  return anidadasDesde(lineasParameters, i);
}

type ParametroDoc = {
  name: string;
  in: string;
  required: boolean;
  description: string;
  schema: Record<string, unknown>;
};

const parametrosTs = openApiSpec.paths[PATH_LISTADO].get
  .parameters as unknown as readonly ParametroDoc[];

function parametroTs(nombre: string): ParametroDoc {
  const p = parametrosTs.find((q) => q.name === nombre);
  if (!p) throw new Error(`El objeto TS no declara el parámetro \`${nombre}\``);
  return p;
}

/** Los cuatro filtros nuevos, con el tipo/formato y el ejemplo que fijó `design.md` §5. */
const FILTROS_NUEVOS = [
  {
    nombre: "desde",
    schema: { type: "string", format: "date", example: "2026-08-01" },
    ejemploEnYaml: 'example: "2026-08-01"',
  },
  {
    nombre: "hasta",
    schema: { type: "string", format: "date", example: "2026-08-21" },
    ejemploEnYaml: 'example: "2026-08-21"',
  },
  {
    nombre: "num_guia",
    schema: { type: "integer", minimum: 1, example: 100234 },
    ejemploEnYaml: "example: 100234",
  },
  {
    nombre: "num_remision",
    schema: { type: "string", minLength: 1, example: "REM-0001" },
    ejemploEnYaml: 'example: "REM-0001"',
  },
] as const;

/** Los tres parámetros que ya existían antes de la 257 y que la feature NO puede haber retirado. */
const FILTROS_PREEXISTENTES = ["limit", "offset", "estado"] as const;

describe("257/R26 — el OpenAPI publica los cuatro filtros nuevos del listado por API key", () => {
  it("R26: el objeto TS declara los cuatro parámetros nuevos como query opcionales, con descripción y ejemplo", () => {
    for (const { nombre } of FILTROS_NUEVOS) {
      const parametro = parametroTs(nombre);
      expect(parametro.in).toBe("query");
      expect(parametro.required).toBe(false);
      expect(typeof parametro.description).toBe("string");
      expect(parametro.description.trim().length).toBeGreaterThan(0);
      expect(parametro.schema.example).toBeDefined();
    }
  });

  it("R26: cada parámetro nuevo lleva en el objeto TS el tipo y formato que fijó el diseño", () => {
    for (const { nombre, schema } of FILTROS_NUEVOS) {
      expect(parametroTs(nombre).schema).toEqual(schema);
    }
  });

  it("R26: la feature es aditiva — limit, offset y estado siguen publicados en ambos artefactos", () => {
    const nombresTs = parametrosTs.map((p) => p.name);
    for (const nombre of FILTROS_PREEXISTENTES) {
      expect(nombresTs).toContain(nombre);
      expect(lineasParameters).toContain(`        - name: ${nombre}`);
    }
    // Y no sobra ni falta ninguno: los tres viejos más los cuatro nuevos, en ese orden.
    expect(nombresTs).toEqual([
      ...FILTROS_PREEXISTENTES,
      ...FILTROS_NUEVOS.map((f) => f.nombre),
    ]);
  });

  it("R26: el .yaml espejo declara los cuatro parámetros DENTRO del bloque parameters del get del listado", () => {
    for (const { nombre } of FILTROS_NUEVOS) {
      expect(lineasParameters).toContain(`        - name: ${nombre}`);
      const cuerpo = bloqueDeParametro(nombre).map((l) => l.trim());
      expect(cuerpo).toContain("in: query");
      expect(cuerpo).toContain("required: false");
    }
  });

  it("R26: el .yaml espejo repite el mismo tipo/formato y el mismo ejemplo que el objeto TS", () => {
    for (const { nombre, schema, ejemploEnYaml } of FILTROS_NUEVOS) {
      const cuerpo = bloqueDeParametro(nombre).map((l) => l.trim());
      for (const [clave, valor] of Object.entries(schema)) {
        if (clave === "example") continue;
        expect(cuerpo).toContain(`${clave}: ${valor}`);
      }
      expect(cuerpo).toContain(ejemploEnYaml);
    }
  });

  it("R26: el .yaml espejo copia palabra por palabra la descripción de cada parámetro nuevo", () => {
    for (const { nombre } of FILTROS_NUEVOS) {
      const descripcionTs = parametroTs(nombre).description;
      const cuerpo = bloqueDeParametro(nombre).map((l) => l.trim());
      // El yaml entrecomilla la descripción cuando lleva caracteres especiales; se acepta cualquiera
      // de las dos formas, pero el TEXTO debe ser idéntico.
      const encontrada = cuerpo.some(
        (l) => l === `description: ${descripcionTs}` || l === `description: "${descripcionTs}"`
      );
      expect(encontrada, `el yaml no repite la descripción de \`${nombre}\``).toBe(true);
    }
  });
});

describe("257/R26 — la descripción del endpoint explica el borde que más confunde al integrador", () => {
  const descripcionTs = openApiSpec.paths[PATH_LISTADO].get.description as string;

  it("R26: ambos artefactos avisan de que una guía o remisión ajena devuelve página vacía y no 404", () => {
    for (const texto of [descripcionTs, descripcionYaml]) {
      const plano = texto.replace(/\s+/g, " ");
      expect(plano).toMatch(/página vacía[^]*404|404[^]*página vacía/i);
      expect(plano).toContain("num_guia");
      expect(plano).toContain("num_remision");
    }
    // El yaml no es una paráfrasis: es el mismo texto que el TS, línea a línea.
    expect(descripcionYaml).toBe(descripcionTs);
  });

  it("R26: ambos artefactos dejan claro que `hasta` es INCLUSIVO y que el día se mide en hora de Costa Rica (UTC-6)", () => {
    const descripcionHastaTs = parametroTs("hasta").description;
    expect(descripcionHastaTs).toMatch(/inclusiv/i);
    expect(descripcionHastaTs).toContain("Costa Rica");
    expect(descripcionHastaTs).toContain("UTC-6");

    const cuerpoYaml = bloqueDeParametro("hasta")
      .map((l) => l.trim())
      .join("\n");
    expect(cuerpoYaml).toMatch(/inclusiv/i);
    expect(cuerpoYaml).toContain("Costa Rica");
    expect(cuerpoYaml).toContain("UTC-6");
  });
});
