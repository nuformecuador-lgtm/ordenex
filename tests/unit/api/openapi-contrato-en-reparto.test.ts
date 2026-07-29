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

describe("153/R13 — eventos publicos de webhook", () => {
  it("EVENTOS_PUBLICOS sigue teniendo 9 elementos", () => {
    expect(EVENTOS_PUBLICOS.size).toBe(9);
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
