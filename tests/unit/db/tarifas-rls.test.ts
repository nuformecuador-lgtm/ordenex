import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R7: cobertura estatica de RLS. La verificacion contra Postgres real (query
// directa con key anon rechazada, T004) queda DIFERIDA (sin DB), como
// ordenes-rls.test.ts. La migracion original (20260710120000_cobros) crea la
// tabla como "cobro" (historica, no se reescribe); la migracion de rename
// (20260711180000_rename_cobro_tarifas) la deja como "tarifas" y agrega
// zona_id + tarifa_zona_mensajero (feature 24).
const COBROS = resolve(__dirname, "../../../db/migrations/20260710120000_cobros/migration.sql");
const COBROS_DOWN = resolve(__dirname, "../../../db/migrations/20260710120000_cobros/down.sql");
const RENAME = resolve(
  __dirname,
  "../../../db/migrations/20260711180000_rename_cobro_tarifas/migration.sql",
);
const RENAME_DOWN = resolve(
  __dirname,
  "../../../db/migrations/20260711180000_rename_cobro_tarifas/down.sql",
);

function sql(path: string): string {
  return readFileSync(path, "utf8");
}

describe("RLS habilitado en cobro (migracion original, historica) (R7)", () => {
  it("ALTER TABLE cobro ENABLE ROW LEVEL SECURITY", () => {
    expect(sql(COBROS)).toContain('ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY;');
  });
});

describe("migracion original de cobro: columnas, tipos y NOT NULL (R1/R2/R3/R5)", () => {
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

describe("down.sql original revierte solo la tabla cobro (R6)", () => {
  it('DROP TABLE IF EXISTS "cobro"', () => {
    expect(sql(COBROS_DOWN)).toContain('DROP TABLE IF EXISTS "cobro";');
  });

  it("no menciona ninguna otra tabla del esquema", () => {
    const s = sql(COBROS_DOWN);
    for (const otraTabla of ["orden", "usuario", "order_status", "zona", "provincia"]) {
      expect(s).not.toContain(`"${otraTabla}"`);
    }
  });
});

describe("migracion de rename cobro -> tarifas (feature 24)", () => {
  it("renombra la tabla, la PK y el indice de created_at", () => {
    const s = sql(RENAME);
    expect(s).toContain('ALTER TABLE "cobro" RENAME TO "tarifas";');
    expect(s).toContain('ALTER TABLE "tarifas" RENAME CONSTRAINT "cobro_pkey" TO "tarifas_pkey";');
    expect(s).toContain('ALTER INDEX "cobro_created_at_idx" RENAME TO "tarifas_created_at_idx";');
  });

  it("agrega zona_id NULLABLE a tarifas con FK e indice", () => {
    const s = sql(RENAME);
    expect(s).toContain('ALTER TABLE "tarifas" ADD COLUMN "zona_id" TEXT;');
    expect(s).not.toContain('ADD COLUMN "zona_id" TEXT NOT NULL');
    expect(s).toContain('CREATE INDEX "tarifas_zona_id_idx" ON "tarifas"("zona_id");');
    expect(s).toContain(
      'ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id")',
    );
  });

  it("agrega cobro_vehiculo BOOLEAN NOT NULL DEFAULT false a zona", () => {
    expect(sql(RENAME)).toContain(
      'ALTER TABLE "zona" ADD COLUMN "cobro_vehiculo" BOOLEAN NOT NULL DEFAULT false;',
    );
  });

  it("crea tarifa_zona_mensajero con FKs a vehiculos/zona y RLS habilitado", () => {
    const s = sql(RENAME);
    expect(s).toContain('CREATE TABLE "tarifa_zona_mensajero"');
    expect(s).toContain('"cobro_entregado" DECIMAL(12,2) NOT NULL');
    expect(s).toContain('"cobro_rechazado" DECIMAL(12,2) NOT NULL');
    expect(s).toContain('"vehiculo_id" TEXT,');
    expect(s).toContain('"zona_id" TEXT NOT NULL');
    expect(s).toContain(
      'FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
    );
    expect(s).toContain(
      'FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;',
    );
    expect(s).toContain('ALTER TABLE "tarifa_zona_mensajero" ENABLE ROW LEVEL SECURITY;');
  });
});

describe("down.sql del rename revierte exactamente en orden inverso", () => {
  it("borra tarifa_zona_mensajero, columnas nuevas y renombra de vuelta a cobro", () => {
    const s = sql(RENAME_DOWN);
    expect(s).toContain('DROP TABLE IF EXISTS "tarifa_zona_mensajero";');
    expect(s).toContain('ALTER TABLE "zona" DROP COLUMN IF EXISTS "cobro_vehiculo";');
    expect(s).toContain('ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "zona_id";');
    expect(s).toContain('ALTER TABLE "tarifas" RENAME TO "cobro";');
    expect(s).toContain('ALTER TABLE "tarifas" RENAME CONSTRAINT "tarifas_pkey" TO "cobro_pkey";');
  });

  it("el orden respeta la dependencia: tarifa_zona_mensajero antes que el rename de vuelta", () => {
    const s = sql(RENAME_DOWN);
    const idxDropTabla = s.indexOf('DROP TABLE IF EXISTS "tarifa_zona_mensajero"');
    const idxRename = s.indexOf('ALTER TABLE "tarifas" RENAME TO "cobro"');
    expect(idxDropTabla).toBeGreaterThanOrEqual(0);
    expect(idxRename).toBeGreaterThan(idxDropTabla);
  });
});
