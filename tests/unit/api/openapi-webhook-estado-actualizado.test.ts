import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

// Feature 256/R24 — el evento saliente `orden.estado_actualizado` ESTA PUBLICADO en el contrato.
//
// Este test es AFIRMATIVO, no de no-regresion: las dos guardias hermanas
// (`openapi-contrato-en-reparto.test.ts`, `openapi-177-paths-pdf-y-carga-id.test.ts`) pasarian
// igual si la seccion `webhooks` no existiera. Aqui se afirma que existe, donde vive, que forma
// tiene y que el `.yaml` publicado la refleja con la misma estructura.
//
// Ojo con el punto de `data.estado` SIN `enum`: no es un detalle de estilo. Enumerar el catalogo
// de estados aqui añadiria un 5.º bloque y pondria ROJA `openapi-contrato-en-reparto.test.ts`,
// que exige exactamente 4 (design 256 §5.2). El assert existe para que quien "mejore" la doc vea
// el motivo aqui y no en la guardia hermana.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yamlTexto = fs.readFileSync(YAML_PATH, "utf8");

const EVENTO = "orden.estado_actualizado";

// ---------------------------------------------------------------------------------------------
// Parseo del .yaml. js-yaml NO es resoluble desde la raiz del proyecto (vive solo en el store
// oculto de pnpm), y el resto de los tests de openapi leen el archivo como TEXTO. Se mantiene ese
// molde y se parsea SOLO el bloque `webhooks:` con un lector del subconjunto YAML que ese bloque
// usa: mapas, secuencias, escalares planos/entrecomillados y bloques `|-`. Cualquier construccion
// fuera de ese subconjunto lanza en vez de devolver un objeto a medias.
// ---------------------------------------------------------------------------------------------

const RE_CLAVE = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_./$-]+):(?:\s+(.*))?$/;

function sangria(linea: string): number {
  return linea.length - linea.trimStart().length;
}

function esIgnorable(linea: string): boolean {
  return linea.trim() === "" || linea.trimStart().startsWith("#");
}

function escalar(crudo: string): unknown {
  const s = crudo.trim();
  if (s.startsWith('"')) return JSON.parse(s) as string;
  if (s === "[]") return [];
  if (s === "{}") return {};
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/** Lee un escalar de bloque (`|-` / `|`) que empieza en `i`. Devuelve el texto y el indice siguiente. */
function leerBloque(lineas: string[], i: number, indClave: number, strip: boolean): [string, number] {
  const crudas: string[] = [];
  while (i < lineas.length) {
    const linea = lineas[i];
    if (linea.trim() === "") {
      crudas.push("");
      i++;
      continue;
    }
    if (sangria(linea) <= indClave) break;
    crudas.push(linea);
    i++;
  }
  while (crudas.length > 0 && crudas[crudas.length - 1] === "") crudas.pop();
  const utiles = crudas.filter((l) => l !== "");
  const base = utiles.length > 0 ? Math.min(...utiles.map(sangria)) : 0;
  const texto = crudas.map((l) => (l === "" ? "" : l.slice(base))).join("\n");
  return [strip ? texto : `${texto}\n`, i];
}

function parseNodo(lineas: string[], i: number, ind: number): [unknown, number] {
  if (lineas[i].trimStart().startsWith("- ")) {
    const arr: unknown[] = [];
    while (i < lineas.length) {
      const linea = lineas[i];
      if (esIgnorable(linea)) {
        i++;
        continue;
      }
      if (sangria(linea) !== ind || !linea.trimStart().startsWith("- ")) break;
      const resto = linea.trimStart().slice(2).trim();
      if (RE_CLAVE.test(resto)) {
        const hijoInd = ind + 2;
        const sub = [" ".repeat(hijoInd) + resto, ...lineas.slice(i + 1)];
        const [valor, consumidas] = parseNodo(sub, 0, hijoInd);
        arr.push(valor);
        i += consumidas;
      } else {
        arr.push(escalar(resto));
        i++;
      }
    }
    return [arr, i];
  }

  const mapa: Record<string, unknown> = {};
  while (i < lineas.length) {
    const linea = lineas[i];
    if (esIgnorable(linea)) {
      i++;
      continue;
    }
    const actual = sangria(linea);
    if (actual < ind) break;
    if (actual > ind) throw new Error(`sangria inesperada en el .yaml: ${linea}`);
    const m = RE_CLAVE.exec(linea.trim());
    if (!m) throw new Error(`linea del .yaml no reconocida: ${linea}`);
    const clave = m[1].startsWith('"') ? (JSON.parse(m[1]) as string) : m[1];
    const resto = (m[2] ?? "").trim();
    i++;
    if (resto === "|-" || resto === "|") {
      const [texto, j] = leerBloque(lineas, i, ind, resto === "|-");
      mapa[clave] = texto;
      i = j;
    } else if (resto === "") {
      let j = i;
      while (j < lineas.length && esIgnorable(lineas[j])) j++;
      if (j >= lineas.length || sangria(lineas[j]) <= ind) {
        mapa[clave] = null;
      } else {
        const [valor, k] = parseNodo(lineas, j, sangria(lineas[j]));
        mapa[clave] = valor;
        i = k;
      }
    } else {
      mapa[clave] = escalar(resto);
    }
  }
  return [mapa, i];
}

/** Lineas del bloque de NIVEL SUPERIOR `<nombre>:` del .yaml (sin su cabecera). */
function lineasDeSeccionTopLevel(nombre: string): string[] {
  const lineas = yamlTexto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === `${nombre}:`);
  if (inicio === -1) {
    throw new Error(`el .yaml no declara la seccion de NIVEL SUPERIOR ${nombre}:`);
  }
  const out: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea.trim() !== "" && sangria(linea) === 0) break;
    out.push(linea);
  }
  return out;
}

function seccionWebhooksDelYaml(): Record<string, unknown> {
  const lineas = lineasDeSeccionTopLevel("webhooks");
  const primera = lineas.findIndex((l) => !esIgnorable(l));
  if (primera === -1) throw new Error("la seccion `webhooks:` del .yaml esta vacia");
  const [nodo] = parseNodo(lineas, primera, sangria(lineas[primera]));
  return nodo as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Accesos al objeto TS (fuente de verdad) y a su espejo publicado.
// ---------------------------------------------------------------------------------------------

const webhookTs = openApiSpec.webhooks[EVENTO];
const bodySchemaTs = webhookTs.post.requestBody.content["application/json"].schema;
const dataTs = bodySchemaTs.properties.data;
const webhooksYaml = seccionWebhooksDelYaml();

/** Navega un objeto plano parseado del .yaml, lanzando si el camino no existe. */
function porCamino(raiz: unknown, ...camino: string[]): Record<string, unknown> {
  let actual: unknown = raiz;
  for (const paso of camino) {
    if (actual === null || typeof actual !== "object") {
      throw new Error(`el .yaml no tiene el camino ${camino.join(" > ")} (corta en ${paso})`);
    }
    actual = (actual as Record<string, unknown>)[paso];
  }
  if (actual === null || typeof actual !== "object") {
    throw new Error(`el .yaml no tiene el camino ${camino.join(" > ")}`);
  }
  return actual as Record<string, unknown>;
}

const dataYaml = porCamino(
  webhooksYaml,
  EVENTO,
  "post",
  "requestBody",
  "content",
  "application/json",
  "schema",
  "properties",
  "data",
);

/** Recolecta todos los arrays `enum` de un subarbol del contrato. */
function todosLosEnums(nodo: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(nodo)) {
    for (const item of nodo) todosLosEnums(item, out);
    return out;
  }
  if (nodo && typeof nodo === "object") {
    for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
      if (clave === "enum" && Array.isArray(valor)) out.push(valor);
      todosLosEnums(valor, out);
    }
  }
  return out;
}

describe("256/R24 — el webhook orden.estado_actualizado esta publicado en el contrato", () => {
  it("256/R24: `webhooks[orden.estado_actualizado]` existe a NIVEL SUPERIOR, fuera de `paths`", () => {
    // TS: la seccion es hermana de `paths`, no una ruta mas.
    expect(Object.keys(openApiSpec)).toContain("webhooks");
    expect(Object.keys(openApiSpec.webhooks)).toEqual([EVENTO]);
    expect(webhookTs.post.operationId).toBe("webhookOrdenEstadoActualizado");
    expect(Object.keys(openApiSpec.paths)).not.toContain(EVENTO);
    expect(JSON.stringify(openApiSpec.paths)).not.toContain(EVENTO);

    // .yaml: `webhooks:` empieza en la columna 0 (si colgara de `paths` iria sangrado).
    expect(yamlTexto).toMatch(/^webhooks:$/m);
    expect(Object.keys(webhooksYaml)).toEqual([EVENTO]);
    expect(porCamino(webhooksYaml, EVENTO, "post").operationId).toBe(
      "webhookOrdenEstadoActualizado",
    );
  });

  it("256/R24: el schema de `data` tiene EXACTAMENTE numGuia, numRemision, estado, motivo, y las cuatro son required", () => {
    const CUATRO = ["numGuia", "numRemision", "estado", "motivo"];

    expect(Object.keys(dataTs.properties)).toEqual(CUATRO);
    expect([...dataTs.required].sort()).toEqual([...CUATRO].sort());

    expect(Object.keys(porCamino(dataYaml, "properties"))).toEqual(CUATRO);
    expect([...(dataYaml.required as string[])].sort()).toEqual([...CUATRO].sort());
  });

  it("256/R24: el `enum` de `motivo` son los tres values de CAUSA_DEVOLUCION_SEED (mas null)", () => {
    const enumTs: readonly unknown[] = dataTs.properties.motivo.enum;
    const enumYaml = porCamino(dataYaml, "properties", "motivo").enum as unknown[];

    for (const lista of [enumTs, enumYaml]) {
      const strings = lista.filter((v): v is string => typeof v === "string");
      // El SEED es la fuente de verdad: si la 73 agrega o quita una causa, esto se pone rojo.
      expect(strings).toEqual([...CAUSA_DEVOLUCION_SEED]);
      // `null` esta escrito en el enum: es un value legitimo del campo, no una omision.
      expect(lista).toContain(null);
      expect(lista).toHaveLength(CAUSA_DEVOLUCION_SEED.length + 1);
    }

    // El tipo acompaña: string|null, nunca solo string.
    expect(dataTs.properties.motivo.type).toEqual(["string", "null"]);
    expect(porCamino(dataYaml, "properties", "motivo").type).toEqual(["string", "null"]);
  });

  it("256/R24: `estado` se documenta SIN `enum` (design §5.2: un 5.º catalogo pondria roja openapi-contrato-en-reparto)", () => {
    const estadoTs: Record<string, unknown> = dataTs.properties.estado;
    const estadoYaml = porCamino(dataYaml, "properties", "estado");

    expect(estadoTs).not.toHaveProperty("enum");
    expect(estadoYaml).not.toHaveProperty("enum");
    expect(estadoTs.type).toBe("string");
    expect(estadoYaml.type).toBe("string");
    // Y NINGUN enum del subarbol del webhook enumera estados de orden.
    for (const lista of [...todosLosEnums(openApiSpec.webhooks), ...todosLosEnums(webhooksYaml)]) {
      expect(lista).not.toContain("entregada");
      expect(lista).not.toContain("por_recoger");
    }
    // La prosa remite al catalogo publicado en vez de repetirlo.
    expect(estadoTs.description).toContain("OrdenListItem.estado");
  });

  it("256/R24 (+R15): la prosa de `motivo` documenta el caso `null` y que la causa es la VIGENTE al entregar", () => {
    const descripcionTs: string = dataTs.properties.motivo.description;
    const descripcionYaml = porCamino(dataYaml, "properties", "motivo").description as string;

    for (const descripcion of [descripcionTs, descripcionYaml]) {
      // Caso null, en sus dos ramas (no-devuelta y devuelta sin causa registrada).
      expect(descripcion).toContain("Es `null` en todo evento cuyo `estado` NO sea `devuelta`");
      expect(descripcion).toContain("`devuelta` sin causa registrada");
      expect(descripcion).toContain("el campo NUNCA se omite");
      // R15: motivo vigente al entregar, no una foto del instante del cambio de estado.
      expect(descripcion).toContain("**Es el motivo VIGENTE EN EL MOMENTO DE LA ENTREGA**");
      expect(descripcion).toContain("no una foto del instante del");
    }
    // La forma unica (las cuatro claves siempre presentes) tambien esta dicha en `data`.
    expect(dataTs.description).toContain("las cuatro claves están SIEMPRE presentes");
  });

  it("256/R24: se documentan las cabeceras de firma X-Ordenex-Signature y X-Ordenex-Timestamp", () => {
    const parametrosTs: readonly Record<string, unknown>[] = webhookTs.post.parameters;
    const parametrosYaml = porCamino(webhooksYaml, EVENTO, "post").parameters as Record<
      string,
      unknown
    >[];

    for (const parametros of [parametrosTs, parametrosYaml]) {
      expect(parametros.map((p) => p.name)).toEqual(["X-Ordenex-Signature", "X-Ordenex-Timestamp"]);
      for (const parametro of parametros) {
        expect(parametro.in).toBe("header");
        expect(parametro.required).toBe(true);
      }
    }
    // La firma dice sobre QUE se calcula el HMAC: sin eso el integrador no puede verificarla.
    expect(webhookTs.post.description).toContain("HMAC-SHA256");
    expect(webhookTs.post.description).toContain("${timestamp}.${cuerpo}");
  });

  it("256/R24: paridad TS↔YAML — la seccion `webhooks` publicada es espejo EXACTO del objeto TS", () => {
    expect(JSON.stringify(webhooksYaml)).toEqual(JSON.stringify(openApiSpec.webhooks));
  });
});
