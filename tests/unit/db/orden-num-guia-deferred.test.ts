import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R1/R3/R4/R7/R10: cobertura estatica (sin DB) de la migracion de esta feature,
// patron tests/unit/db/ordenes-rls.test.ts. La verificacion contra Postgres real
// (aplicar/revertir) queda DIFERIDA (sin DB), documentada como deuda de despliegue.
const MIGRATION_DIR = resolve(
  __dirname,
  "../../../db/migrations/20260711130000_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion",
);

function sql(file: string): string {
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
}

describe("migration.sql — num_guia diferido via SEQUENCE (R1/R3/R4)", () => {
  it("quita DEFAULT y NOT NULL de num_guia, conserva UNIQUE (implicito, sin tocarlo)", () => {
    const s = sql("migration.sql");
    expect(s).toContain('ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP DEFAULT;');
    expect(s).toContain('ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP NOT NULL;');
    // R6: no debe tocar el indice/constraint UNIQUE existente de num_guia.
    expect(s).not.toMatch(/DROP\s+(CONSTRAINT|INDEX).*num_guia/i);
  });

  it("desliga la secuencia del SERIAL con OWNED BY NONE (R3)", () => {
    const s = sql("migration.sql");
    expect(s).toContain('ALTER SEQUENCE "orden_num_guia_seq" OWNED BY NONE;');
  });

  it("el orden de sentencias respeta design.md: num_guia antes que mensajero_asignado_id antes que el catalogo", () => {
    const s = sql("migration.sql");
    const idxNumGuia = s.indexOf('ALTER COLUMN "num_guia" DROP DEFAULT');
    const idxMensajero = s.indexOf('ADD COLUMN "mensajero_asignado_id"');
    const idxCatalogo = s.indexOf("ADD VALUE IF NOT EXISTS 'en_espera_aceptacion'");
    expect(idxNumGuia).toBeGreaterThanOrEqual(0);
    expect(idxMensajero).toBeGreaterThan(idxNumGuia);
    expect(idxCatalogo).toBeGreaterThan(idxMensajero);
  });
});

describe("migration.sql — mensajero_asignado_id (R7)", () => {
  it("agrega la columna nullable + indice + FK ON DELETE SET NULL", () => {
    const s = sql("migration.sql");
    expect(s).toContain('ALTER TABLE "orden" ADD COLUMN "mensajero_asignado_id" TEXT;');
    expect(s).toContain(
      'CREATE INDEX "orden_mensajero_asignado_id_idx" ON "orden"("mensajero_asignado_id");',
    );
    expect(s).toMatch(/orden_mensajero_asignado_id_fkey[\s\S]*ON DELETE SET NULL/);
    expect(s).toContain('REFERENCES "usuario"("id")');
  });
});

describe("migration.sql — catalogo en_espera_aceptacion (R10)", () => {
  it("agrega el valor al enum standalone order_status_value de forma idempotente", () => {
    const s = sql("migration.sql");
    expect(s).toContain(
      `ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_espera_aceptacion';`,
    );
  });

  it("inserta la fila de catalogo con ON CONFLICT DO NOTHING", () => {
    const s = sql("migration.sql");
    expect(s).toMatch(
      /INSERT INTO "order_status"[\s\S]*'en_espera_aceptacion'[\s\S]*ON CONFLICT \("value"\) DO NOTHING;/,
    );
  });
});

describe("down.sql — reversion en orden inverso (R6/R10)", () => {
  it("documenta que revertir num_guia a NOT NULL FALLA si hay guias NULL", () => {
    const s = sql("down.sql");
    expect(s).toMatch(/ADVERTENCIA/i);
    expect(s).toMatch(/FALLA/i);
    expect(s).toContain('ALTER TABLE "orden" ALTER COLUMN "num_guia" SET NOT NULL;');
    expect(s).toContain('ALTER TABLE "orden" ALTER COLUMN "num_guia" SET DEFAULT nextval');
    expect(s).toContain('ALTER SEQUENCE "orden_num_guia_seq" OWNED BY "orden"."num_guia";');
  });

  it("borra la fila de catalogo SOLO si ninguna orden la referencia", () => {
    const s = sql("down.sql");
    expect(s).toMatch(/DELETE FROM "order_status" WHERE "value" = 'en_espera_aceptacion'/);
    expect(s).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden"/);
  });

  it("revierte mensajero_asignado_id: drop FK, indice y columna", () => {
    const s = sql("down.sql");
    expect(s).toContain(
      'ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_asignado_id_fkey";',
    );
    expect(s).toContain('DROP INDEX IF EXISTS "orden_mensajero_asignado_id_idx";');
    expect(s).toContain('ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_asignado_id";');
  });
});
