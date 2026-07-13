import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 55 / R13 (F1.4-C) — cobertura ESTATICA anti-regresion del drift
// schema<->DB en `provincia.zona_id`. La columna fue ELIMINADA en la DB por la
// migracion 20260711120000_zonas_catalogo_global_pagos y nunca re-creada; el
// schema.prisma NO debe volver a declarar los simbolos huerfanos
// `Provincia.zonaId`/`Provincia.zona`/`Zona.provincias`. Lee el fichero y hace
// asserts sobre el texto (patron de zonas-migration.test.ts). NO requiere Postgres.

const ROOT = path.join(__dirname, "..", "..", "..");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

// Extrae el bloque `model <Name> { ... }` del schema.prisma.
function modelBlock(name: string): string {
  const re = new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = schema.match(re);
  if (!m) throw new Error(`No se encontro el modelo ${name} en schema.prisma`);
  return m[1];
}

describe("R13 — provincia.zona_id drift reconciliado (schema-only)", () => {
  const provincia = modelBlock("Provincia");
  const zona = modelBlock("Zona");

  it("el modelo Provincia NO declara la columna escalar zona_id/zonaId", () => {
    expect(provincia).not.toMatch(/@map\("zona_id"\)/);
    expect(provincia).not.toMatch(/\bzonaId\b/);
  });

  it("el modelo Provincia NO declara la relacion `zona Zona?`", () => {
    expect(provincia).not.toMatch(/\bzona\s+Zona\??/);
    expect(provincia).not.toMatch(/@relation\(fields:\s*\[zonaId\]/);
  });

  it("el modelo Provincia conserva nombre, cantones y ordenes", () => {
    expect(provincia).toMatch(/nombre\s+String/);
    expect(provincia).toMatch(/cantones\s+Canton\[\]/);
    expect(provincia).toMatch(/ordenes\s+Orden\[\]/);
  });

  it("el modelo Zona NO declara la relacion inversa `provincias Provincia[]`", () => {
    expect(zona).not.toMatch(/\bprovincias\b/);
    expect(zona).not.toMatch(/Provincia\[\]/);
  });

  it("el modelo Zona conserva esCentral y el N:M de distritos", () => {
    expect(zona).toMatch(/esCentral\s+Boolean/);
    expect(zona).toMatch(/distritos\s+ZonaDistrito\[\]/);
  });
});
