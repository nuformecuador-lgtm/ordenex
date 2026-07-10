import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R7: cobertura estatica de RLS. La verificacion contra Postgres real (query
// directa con key anon rechazada, T004) queda DIFERIDA (sin DB), como
// ordenes-rls.test.ts. Aqui se comprueba que la migracion de "cobro" habilita
// RLS, define las 9 columnas NOT NULL con los tipos correctos y NO agrega un
// indice unico sobre "nombre" (design.md "Unicidad de nombre").
const COBROS = resolve(__dirname, "../../../db/migrations/20260710120000_cobros/migration.sql");
const DOWN = resolve(__dirname, "../../../db/migrations/20260710120000_cobros/down.sql");

function sql(path: string): string {
  return readFileSync(path, "utf8");
}

describe("RLS habilitado en cobro (R7)", () => {
  it("ALTER TABLE cobro ENABLE ROW LEVEL SECURITY", () => {
    expect(sql(COBROS)).toContain('ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY;');
  });
});

describe("migracion de cobro: columnas, tipos y NOT NULL (R1/R2/R3/R5)", () => {
  it("nombre TEXT NOT NULL, sin indice unico sobre nombre (D1)", () => {
    const s = sql(COBROS);
    expect(s).toContain('"nombre" TEXT NOT NULL');
    expect(s).not.toMatch(/UNIQUE INDEX "cobro_nombre_key"/);
  });

  it("5 columnas de monto DECIMAL(12,2) NOT NULL (R2)", () => {
    const s = sql(COBROS);
    for (const col of [
      "valor_flete",
      "valor_flete_devuelto",
      "valor_flete_gam",
      "valor_flete_devuelto_gam",
      "fulfillment",
    ]) {
      expect(s).toContain(`"${col}" DECIMAL(12,2) NOT NULL`);
    }
  });

  it("3 columnas de porcentaje DECIMAL(5,2) NOT NULL (R3)", () => {
    const s = sql(COBROS);
    for (const col of ["comision_cod", "iva_flete", "iva_comision_cod"]) {
      expect(s).toContain(`"${col}" DECIMAL(5,2) NOT NULL`);
    }
  });

  it("deleted_at nullable, created_at con default, updated_at NOT NULL", () => {
    const s = sql(COBROS);
    expect(s).toContain('"deleted_at" TIMESTAMP(3),');
    expect(s).toContain('"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(s).toContain('"updated_at" TIMESTAMP(3) NOT NULL');
  });

  it("indice por created_at para el orden por defecto del listado (R18)", () => {
    expect(sql(COBROS)).toContain('CREATE INDEX "cobro_created_at_idx" ON "cobro"("created_at");');
  });

  it("sin FKs (D1: no hay relacion con zona/orden/tienda en esta feature)", () => {
    expect(sql(COBROS)).not.toContain("AddForeignKey");
  });
});

describe("down.sql revierte solo la tabla cobro (R6)", () => {
  it('DROP TABLE IF EXISTS "cobro"', () => {
    expect(sql(DOWN)).toContain('DROP TABLE IF EXISTS "cobro";');
  });

  it("no menciona ninguna otra tabla del esquema", () => {
    const s = sql(DOWN);
    for (const otraTabla of ["orden", "usuario", "order_status", "zona", "provincia"]) {
      expect(s).not.toContain(`"${otraTabla}"`);
    }
  });
});
