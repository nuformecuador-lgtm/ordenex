import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R16: cobertura estatica de RLS. La verificacion contra Postgres real (query
// directa con key anon rechazada) queda DIFERIDA (sin DB), como login T004/T020.
// Aqui se comprueba que las migraciones habilitan RLS en las 6 tablas nuevas.
const CATALOGOS = resolve(
  __dirname,
  "../../../db/migrations/20260709130000_ordenes_catalogos_geografia/migration.sql",
);
const ORDENES = resolve(
  __dirname,
  "../../../db/migrations/20260709130100_ordenes/migration.sql",
);

function sql(path: string): string {
  return readFileSync(path, "utf8");
}

describe("RLS habilitado en las tablas nuevas (R16)", () => {
  it("catalogos + geografia: order_status, zona, provincia, canton, distrito", () => {
    const s = sql(CATALOGOS);
    for (const tabla of ["order_status", "zona", "provincia", "canton", "distrito"]) {
      expect(s).toContain(`ALTER TABLE "${tabla}" ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("orden: ENABLE ROW LEVEL SECURITY", () => {
    expect(sql(ORDENES)).toContain('ALTER TABLE "orden" ENABLE ROW LEVEL SECURITY;');
  });
});

describe("migracion de orden: SERIAL, uniques y FKs (R8/R12/R14)", () => {
  it("num_guia es SERIAL y hay indices unicos", () => {
    const s = sql(ORDENES);
    expect(s).toContain('"num_guia" SERIAL NOT NULL');
    expect(s).toContain('CREATE UNIQUE INDEX "orden_num_guia_key"');
    expect(s).toContain('CREATE UNIQUE INDEX "orden_num_remision_key"');
  });

  it("distrito_id con ON DELETE SET NULL; zona/provincia/canton NOT NULL", () => {
    const s = sql(ORDENES);
    expect(s).toContain('"zona_id" TEXT NOT NULL');
    expect(s).toContain('"provincia_id" TEXT NOT NULL');
    expect(s).toContain('"canton_id" TEXT NOT NULL');
    expect(s).toContain('"distrito_id" TEXT,');
    expect(s).toMatch(/orden_distrito_id_fkey[\s\S]*ON DELETE SET NULL/);
  });
});
