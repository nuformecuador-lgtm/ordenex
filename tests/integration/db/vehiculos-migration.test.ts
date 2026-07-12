import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { VEHICULOS_SEED } from "@/lib/types/vehiculos";

// Feature 50: cobertura ESTATICA de la migracion de vehiculos (enum Postgres +
// tabla + RLS). Patron order-status-enum-migration.test.ts / cobros-rls.test.ts:
// NO requiere Postgres real, lee migration.sql/down.sql y hace asserts (R3/R4/R5).
// La aplicacion real contra Postgres queda DIFERIDA (deuda de despliegue).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function vehiculosMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_vehiculos"));
  if (!dir) throw new Error("No se encontro la carpeta de migracion *_vehiculos");
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = vehiculosMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

function extractEnumValues(sql: string): string[] {
  const match = sql.match(/CREATE TYPE "vehiculo_value" AS ENUM \(([\s\S]*?)\);/);
  if (!match) throw new Error('No se encontro CREATE TYPE "vehiculo_value" AS ENUM (...)');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("vehiculos migration.sql (UP) — enum + tabla + RLS (R3)", () => {
  it("crea el tipo CREATE TYPE vehiculo_value AS ENUM", () => {
    expect(upSql).toMatch(/CREATE TYPE "vehiculo_value" AS ENUM/);
  });

  it("el enum tiene exactamente los 3 valores de VEHICULOS_SEED (R3)", () => {
    const enumValues = extractEnumValues(upSql);
    expect(enumValues).toHaveLength(3);
    expect(new Set(enumValues)).toEqual(new Set(VEHICULOS_SEED));
  });

  it("crea la tabla vehiculos con id TEXT PK y columna name (NO value) (R3)", () => {
    expect(upSql).toMatch(/CREATE TABLE "vehiculos"/);
    expect(upSql).toContain('"id" TEXT NOT NULL');
    expect(upSql).toContain('"name" "vehiculo_value" NOT NULL');
    expect(upSql).toMatch(/CONSTRAINT "vehiculos_pkey" PRIMARY KEY \("id"\)/);
    // Diferencia clave: la columna NO se llama value.
    expect(upSql).not.toMatch(/"value"\s+"vehiculo_value"/);
  });

  it("crea el indice unico vehiculos_name_key sobre name (R3)", () => {
    expect(upSql).toContain('CREATE UNIQUE INDEX "vehiculos_name_key" ON "vehiculos"("name");');
  });

  it("habilita RLS sobre vehiculos (R3)", () => {
    expect(upSql).toContain('ALTER TABLE "vehiculos" ENABLE ROW LEVEL SECURITY;');
  });

  it("no crea FKs (el FK vehiculo_id de la feature 21 no se implementa aqui) (R13)", () => {
    expect(upSql).not.toContain("ADD CONSTRAINT");
    expect(upSql).not.toMatch(/FOREIGN KEY/);
  });
});

describe("vehiculos down.sql (DOWN) — revierte tabla antes que tipo (R4, R5)", () => {
  it("hace DROP TABLE IF EXISTS vehiculos y DROP TYPE IF EXISTS vehiculo_value", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "vehiculos";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "vehiculo_value";/);
  });

  it("elimina la tabla ANTES que el tipo del que depende (R4/R5)", () => {
    const idxTable = downSql.indexOf('DROP TABLE IF EXISTS "vehiculos"');
    const idxType = downSql.indexOf('DROP TYPE IF EXISTS "vehiculo_value"');
    expect(idxTable).toBeGreaterThanOrEqual(0);
    expect(idxType).toBeGreaterThan(idxTable);
  });

  it("no menciona ninguna otra tabla ni tipo del esquema", () => {
    for (const otro of ["cobro", "orden", "usuario", "rol_value", "order_status"]) {
      expect(downSql).not.toContain(`"${otro}"`);
    }
  });
});

describe("no se modifico ninguna migracion previa (R3)", () => {
  // Invariante: cada migracion conserva su orden relativo respecto de sus
  // predecesoras conocidas; nuevas migraciones apendidas despues NO la afectan.
  // Por eso comparamos contra un PREDECESOR FIJO (la ultima migracion que existia
  // cuando se creo vehiculos), no contra el maximo de todo el repo (que crece con
  // features futuras). La asercion sigue fallando si alguien re-fechara vehiculos
  // ANTES de su predecesor.
  it("vehiculos fue apendida despues de su predecesor conocido (order_status_value_enum)", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const vehiculosDir = dirs.find((d) => d.endsWith("_vehiculos"));
    expect(vehiculosDir).toBeDefined();

    // Ultima migracion que existia cuando se creo la feature 50 (vehiculos).
    const predecesor = "20260710150000_order_status_value_enum";
    // Si alguien borra/renombra el predecesor, este test debe fallar.
    expect(dirs).toContain(predecesor);
    // El timestamp (prefijo) de vehiculos es posterior al de su predecesor.
    expect(vehiculosDir! > predecesor).toBe(true);
  });
});
