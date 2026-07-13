import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 49 — cobertura ESTATICA de la migracion `*_orden_historial_estado` (patron
// wallet-migration.test.ts: lee migration.sql/down.sql por regex; NO requiere Postgres
// real; el round-trip up->down->up contra Postgres queda verificado por el implementer).
// Cubre R1 (tabla + enum + columnas), R2 (fila inmutable: sin updated_at/deleted_at),
// R3 (RLS habilitada sin policies), R4 (down reversible en orden inverso, sin tocar
// preexistentes), R5 ((orden_id, created_at)), R24 ((orden_id, estatus_destino_id)).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_historial_estado");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

const ORIGEN_TIPOS = [
  "carga_masiva",
  "creacion_manual",
  "generacion_guia",
  "asignacion_bodega",
  "ruteo_satelite",
  "recepcion_satelite",
  "asignacion_satelite",
  "recoleccion",
  "gestion",
  "liberacion_reprogramada",
  "ajuste_estado",
];

describe("UP — enum orden_historial_origen_tipo (R23)", () => {
  it("crea el enum nativo con los 11 tipos de origen", () => {
    expect(upSql).toMatch(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM/);
    for (const tipo of ORIGEN_TIPOS) {
      expect(upSql).toContain(`'${tipo}'`);
    }
  });
});

describe("UP — tabla orden_historial_estado (R1/R2)", () => {
  it("crea la tabla con todas las columnas del design §1.1", () => {
    expect(upSql).toMatch(/CREATE TABLE "orden_historial_estado"/);
    expect(upSql).toMatch(/"orden_id" TEXT NOT NULL/);
    expect(upSql).toMatch(/"estatus_origen_id" TEXT,/); // nullable (creacion, R1/R20)
    expect(upSql).toMatch(/"estatus_destino_id" TEXT NOT NULL/);
    expect(upSql).toMatch(/"actor_usuario_id" TEXT,/); // nullable (sistema, R21)
    expect(upSql).toMatch(/"origen_tipo" "orden_historial_origen_tipo" NOT NULL/);
    expect(upSql).toMatch(/"motivo" TEXT,/);
    expect(upSql).toMatch(/"gestion_orden_id" TEXT,/);
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("R2: fila INMUTABLE — SIN updated_at ni deleted_at", () => {
    expect(upSql).not.toMatch(/"updated_at"/);
    expect(upSql).not.toMatch(/"deleted_at"/);
  });
});

describe("UP — las 5 FKs (R1)", () => {
  it("orden -> orden", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("orden_id"\) REFERENCES "orden"\("id"\)/,
    );
  });

  it("estatus origen y destino -> order_status", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("estatus_origen_id"\) REFERENCES "order_status"\("id"\)/,
    );
    expect(upSql).toMatch(
      /FOREIGN KEY \("estatus_destino_id"\) REFERENCES "order_status"\("id"\)/,
    );
  });

  it("R21: actor -> usuario ON DELETE SET NULL (borrar el usuario no borra el rastro)", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("actor_usuario_id"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL/,
    );
  });

  it("gestion -> gestion_orden", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("gestion_orden_id"\) REFERENCES "gestion_orden"\("id"\)/,
    );
  });
});

describe("UP — indices (R5/R24)", () => {
  it("R5: (orden_id, created_at) para la linea de tiempo", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "orden_historial_estado_orden_id_created_at_idx" ON "orden_historial_estado"\("orden_id", "created_at"\);/,
    );
  });

  it("R24: (orden_id, estatus_destino_id) para el conteo de intentos", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "orden_historial_estado_orden_id_estatus_destino_id_idx" ON "orden_historial_estado"\("orden_id", "estatus_destino_id"\);/,
    );
  });
});

describe("R3 — RLS habilitada SIN policies", () => {
  it("ENABLE ROW LEVEL SECURITY sobre orden_historial_estado, sin CREATE POLICY", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "orden_historial_estado" ENABLE ROW LEVEL SECURITY;/,
    );
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R4 — DOWN reversible en orden inverso", () => {
  it("dropea la tabla y luego el enum (orden inverso al UP), sin tocar preexistentes", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "orden_historial_estado";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "orden_historial_origen_tipo";/);

    // orden inverso: tabla (arrastra FKs+indices) -> enum.
    const iTable = downSql.indexOf('DROP TABLE IF EXISTS "orden_historial_estado"');
    const iEnum = downSql.indexOf('DROP TYPE IF EXISTS "orden_historial_origen_tipo"');
    expect(iTable).toBeGreaterThanOrEqual(0);
    expect(iEnum).toBeGreaterThan(iTable);

    // No toca objetos preexistentes: sin ALTER/DROP sobre orden/order_status/usuario/gestion_orden.
    expect(downSql).not.toMatch(/ALTER TABLE "orden"/);
    expect(downSql).not.toMatch(/ALTER TABLE "order_status"/);
    expect(downSql).not.toMatch(/ALTER TABLE "usuario"/);
    expect(downSql).not.toMatch(/DROP TABLE IF EXISTS "gestion_orden"/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a orden_liberada_reprogramada_at (feature 46)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previaDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_orden_liberada_reprogramada_at"));
    expect(previaDir).toBeDefined();
    expect(dirName > (previaDir as string)).toBe(true);
  });
});
