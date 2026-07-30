import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { EVENTOS_PUBLICOS } from "@/lib/types/webhook-eventos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 153 (R13) — contrato EXTERNO del canal por API key y del webhook de estado.
// El rename del value viaja al integrador sin capa de traduccion (decision del gate,
// misma politica que la 135: no se bumpea `info.version`). Este test cubre los TRES
// artefactos del contrato a la vez y, sobre todo, que el .yaml publicado siga siendo
// espejo EXACTO del objeto TS (es un archivo de texto: nada mas lo mantiene sincronizado).
//
// El value ANTIGUO se construye en piezas a proposito: escribirlo literal haria que este
// archivo apareciera como ofensor del guard de censo (censo-order-status-rename.test.ts).
const VALUE_ANTIGUO = ["en", "ruta"].join("_");
const RE_VALUE_ANTIGUO = new RegExp(`\\b${VALUE_ANTIGUO}\\b`);
const VALUE_NUEVO = "en_reparto";

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yaml = fs.readFileSync(YAML_PATH, "utf8");

/**
 * ¿Es este `enum` el catalogo de ESTADOS de orden? Se exige `entregada` Y `por_recoger`:
 * `enum: ["entregada", "rechazada"]` (resultado de gestion) tambien cita `entregada` y NO
 * es el catalogo de estados.
 */
function esEnumDeEstado(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string") &&
    (value as string[]).includes("entregada") &&
    (value as string[]).includes("por_recoger")
  );
}

/** Recolecta todos los arrays `enum` del objeto OpenAPI que enumeran estados de orden. */
function enumsDeEstado(node: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const item of node) enumsDeEstado(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "enum" && esEnumDeEstado(value)) out.push(value);
      enumsDeEstado(value, out);
    }
  }
  return out;
}

/** Extrae del YAML las listas que siguen a una linea `enum:` (items `- valor`). */
function enumsDelYaml(texto: string): string[][] {
  const lineas = texto.split(/\r?\n/);
  const bloques: string[][] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/^\s*enum:\s*$/.test(lineas[i])) continue;
    const items: string[] = [];
    for (let j = i + 1; j < lineas.length; j++) {
      const m = /^\s*-\s+([A-Za-z0-9_]+)\s*$/.exec(lineas[j]);
      if (!m) break;
      items.push(m[1]);
    }
    if (esEnumDeEstado(items)) bloques.push(items);
  }
  return bloques;
}

describe("153/R13 — enum de estados del OpenAPI por API key", () => {
  const enumsTs = enumsDeEstado(openApiSpec);

  it("el objeto TS expone el enum de estados en sus 4 sitios", () => {
    expect(enumsTs).toHaveLength(4);
  });

  it("cada enum contiene en_reparto y NINGUNO conserva el value antiguo", () => {
    for (const lista of enumsTs) {
      expect(lista).toContain(VALUE_NUEVO);
      expect(lista.some((v) => RE_VALUE_ANTIGUO.test(v))).toBe(false);
      // R5: los vecinos siguen en el contrato, intactos.
      expect(lista).toContain("en_ruta_bodega_central");
      expect(lista).toContain("en_ruta_bodega_satelite");
    }
  });

  it("todo value del enum existe en el catalogo (ORDER_STATUS_SEED)", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    for (const lista of enumsTs) {
      for (const value of lista) expect(catalogo.has(value)).toBe(true);
    }
  });

  it("el .yaml publicado sigue siendo espejo EXACTO del objeto TS (4 bloques identicos)", () => {
    const enumsYaml = enumsDelYaml(yaml);
    expect(enumsYaml).toHaveLength(4);
    for (let i = 0; i < enumsYaml.length; i++) {
      expect(enumsYaml[i]).toEqual(enumsTs[i]);
    }
  });

  it("el .yaml no menciona el value antiguo en ninguna linea", () => {
    const ofensoras = yaml
      .split(/\r?\n/)
      .map((linea, idx) => ({ linea, n: idx + 1 }))
      .filter(({ linea }) => RE_VALUE_ANTIGUO.test(linea));
    expect(ofensoras).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 155/R42 — el contrato publico tras el retiro del estado de fulfillment y el cambio
// del estado en que nacen las ordenes creadas por API. El literal retirado se construye por
// concatenacion (patron de este archivo) para no aparecer como ofensor del censo.
// ---------------------------------------------------------------------------------------------
const VALUE_RETIRADO_155 = ["en", "fulfillment"].join("_");
const RE_VALUE_RETIRADO_155 = new RegExp(`\\b${VALUE_RETIRADO_155}\\b`);
const VALUE_NACIMIENTO_API = "por_recolectar_en_tienda";

describe("155/R42 — el contrato del canal por API key tras el retiro", () => {
  const enumsTs = enumsDeEstado(openApiSpec);

  it("ningun enum del objeto TS documenta ya el estado retirado", () => {
    expect(enumsTs).toHaveLength(4);
    for (const lista of enumsTs) {
      expect(lista.some((v) => RE_VALUE_RETIRADO_155.test(v))).toBe(false);
    }
  });

  it("todo enum documenta el estado en que nacen las ordenes creadas por API", () => {
    for (const lista of enumsTs) expect(lista).toContain(VALUE_NACIMIENTO_API);
  });

  it("el .yaml no menciona el value retirado en NINGUNA linea (enum ni prosa)", () => {
    const ofensoras = yaml
      .split(/\r?\n/)
      .map((linea, idx) => ({ linea, n: idx + 1 }))
      .filter(({ linea }) => RE_VALUE_RETIRADO_155.test(linea))
      .map(({ n }) => n);
    expect(ofensoras).toEqual([]);
  });

  it("la descripcion del endpoint de carga anuncia el estado nuevo y el cambio incompatible", () => {
    const descripcion = openApiSpec.paths["/api/ordenes/api-key/carga"].post.description;
    expect(descripcion).toContain(VALUE_NACIMIENTO_API);
    expect(descripcion).toMatch(/CAMBIO INCOMPATIBLE/);
    // El .yaml es espejo textual: la misma nota debe estar publicada.
    expect(yaml).toMatch(/CAMBIO INCOMPATIBLE/);
    expect(yaml).toContain(VALUE_NACIMIENTO_API);
  });

  it("los ejemplos publicados NO siguen mostrando el estado inicial viejo", () => {
    const ejemplo = JSON.stringify(
      openApiSpec.paths["/api/ordenes/api-key/carga"].post.responses["200"],
    );
    expect(ejemplo).not.toContain('"estatus":"en_ruta_bodega_central"');
    expect(ejemplo).toContain(`"estatus":"${VALUE_NACIMIENTO_API}"`);
    expect(ejemplo).toContain(`"estado":"${VALUE_NACIMIENTO_API}"`);
  });
});

describe("153/R13 — eventos publicos de webhook", () => {
  // Feature 155/R43: pasa de 9 a 10 con `por_recolectar_en_tienda`. La ampliacion es ADITIVA:
  // el conteo sube y ningun estado sale (lo verifica el test siguiente, contra la foto de la 153).
  it("EVENTOS_PUBLICOS tiene 10 elementos (9 de la 153 + el nacimiento de la 155)", () => {
    expect(EVENTOS_PUBLICOS.size).toBe(10);
  });

  it("155/R43: los 9 eventos previos siguen TODOS en la politica (nadie deja de recibir)", () => {
    for (const previo of [
      "en_ruta_bodega_central",
      "en_bodega_central",
      "en_reparto",
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
      "devolviendo_a_tienda",
      "devuelta_a_tienda",
    ] as const) {
      expect(EVENTOS_PUBLICOS.has(previo), `dejo de ser evento publico: ${previo}`).toBe(true);
    }
  });

  it("155/R43: el estado de nacimiento de la rama (b) ES evento publico", () => {
    // Sin esto, el integrador que hoy recibe un evento al crear una orden dejaria de recibir
    // cualquier cosa hasta que la orden llegue a la bodega central, y el silencio se leeria
    // como "no se creo".
    expect(EVENTOS_PUBLICOS.has("por_recolectar_en_tienda")).toBe(true);
  });

  it("incluye en_reparto y no el value antiguo; los vecinos no cambian", () => {
    expect(EVENTOS_PUBLICOS.has(VALUE_NUEVO)).toBe(true);
    expect([...EVENTOS_PUBLICOS].some((v) => RE_VALUE_ANTIGUO.test(v))).toBe(false);
    expect(EVENTOS_PUBLICOS.has("en_ruta_bodega_central")).toBe(true);
  });

  it("todo evento publico existe en el catalogo (no hay estado desconocido, R14)", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    for (const evento of EVENTOS_PUBLICOS) expect(catalogo.has(evento)).toBe(true);
  });
});
